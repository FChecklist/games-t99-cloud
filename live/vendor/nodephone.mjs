// The REAL phone game code (zgame.js: PhoneRuntime) run in Node with no screen, over the real network to the local test server and the real public beacon (drand).
// One shared beacon cache keeps 1,000+ phones from hammering drand; every phone still checks the BLS signature of every round it uses (the real check, no shortcut).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";

import { fileURLToPath } from "node:url";
// LIVE PATCH (4 Nov 2026): the assets folder can be chosen with LIVE_ASSETS (zgame.js / control.js fetched from the live site by fetch-assets.mjs); copy of t250/nodephone-t250.mjs otherwise unchanged
const PUB = process.env.LIVE_ASSETS ? process.env.LIVE_ASSETS.replace(/[\/]*$/, "/") : fileURLToPath(new URL("./assets/", import.meta.url));
const store0 = new Map();
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.localStorage = { getItem: (k) => store0.get(k) ?? null, setItem: (k, v) => store0.set(k, String(v)), removeItem: (k) => store0.delete(k) };
// a minimal in-memory IndexedDB so the organizer's signing key (control.js) can be kept as a browser would keep it
{ const stores = new Map(); const later = (r, v) => { setTimeout(() => { r.result = v; r.onsuccess && r.onsuccess(); }, 0); return r; };
  const db = { createObjectStore: (n) => { if (!stores.has(n)) stores.set(n, new Map()); }, transaction: (n) => ({ objectStore: () => ({ get: (k) => later({}, stores.get(n)?.get(k)), put: (v, k) => { stores.get(n).set(k, v); const r = {}; setTimeout(() => { r.result = undefined; r.onsuccess && r.onsuccess(); }, 0); return r; } }) }) };
  let created = false; globalThis.indexedDB = { open: () => { const r = { result: db }; setTimeout(() => { if (!created) { created = true; r.onupgradeneeded && r.onupgradeneeded(); } r.onsuccess && r.onsuccess(); }, 0); return r; } }; }
vm.runInThisContext(readFileSync(PUB + "zgame.js", "utf8"), { filename: "zgame.js" });
vm.runInThisContext(readFileSync(PUB + "control.js", "utf8"), { filename: "control.js" });
export const ZG = globalThis.ZG, TBControl = globalThis.TBControl;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha = (s) => createHash("sha256").update(s).digest("hex");
export const GENESIS = 1692803367, roundAt = (ms) => Math.floor((ms / 1000 - GENESIS) / 3) + 1, roundMs = (r) => (GENESIS + (r - 1) * 3) * 1000;

// ---- the shared beacon cache: each round is fetched from drand once per process; a "latest" answer is kept for 2 s ----
// the public beacon (drand) is reached through a resolver that remembers the last good address of every mirror, so a moment when this laptop's own DNS does not answer cannot silence a whole crowd of test phones
const { Agent, fetch: ufetch } = await import("undici").catch(() => import("file:///C:/ct/ct/node_modules/undici/index.js").catch(() => ({ Agent: class { constructor() {} }, fetch: (u, i) => { const { dispatcher, ...r } = i || {}; return fetch(u, r); } })));
import dns from "node:dns";
const goodAddr = new Map();
const MIRRORS = ["api.drand.sh", "api2.drand.sh", "api3.drand.sh", "drand.cloudflare.com"];
const refreshDns = async (h) => { try { const a = await dns.promises.resolve4(h); if (a.length) goodAddr.set(h, a); } catch { /* keep the last good answer */ } };
await Promise.all(MIRRORS.map(refreshDns)); setInterval(() => MIRRORS.forEach(refreshDns), 120000).unref();
const beaconAgent = new Agent({ keepAliveTimeout: 30000, connections: 512, connect: { lookup: (host, opts, cb) => { const a = goodAddr.get(host); if (a && a.length) { const addr = a[Math.floor(Math.random() * a.length)]; return opts && opts.all ? cb(null, [{ address: addr, family: 4 }]) : cb(null, addr, 4); } return dns.lookup(host, opts, cb); } } });
// t250: one connection pool for every call to the game server, with a cached resolver (c-ares via public resolvers): the phone (Termux) has no working system resolver, and 170 phones should not each wait on the slow system lookup thread pool
try { dns.setServers(["1.1.1.1", "8.8.8.8"]); } catch { /* keep the system servers */ }
const resolveCache = new Map();
const lookupAny = (host, opts, cb) => { const hit = resolveCache.get(host); const done = (arr) => (opts && opts.all ? cb(null, arr.map((x) => ({ address: x, family: 4 }))) : cb(null, arr[Math.floor(Math.random() * arr.length)], 4));
  if (hit && Date.now() - hit.t < 300000) return done(hit.a);
  dns.resolve4(host, (e, a) => { if (!e && a && a.length) { resolveCache.set(host, { t: Date.now(), a }); return done(a); } if (hit) return done(hit.a); dns.lookup(host, opts, cb); }); };
const mainAgent = new Agent({ keepAliveTimeout: 30000, connections: 512, connect: { lookup: lookupAny } });
export const gfetch = (url, init) => ufetch(url, { ...init, dispatcher: mainAgent });
const cache = new Map();
// the real signature check of the real phone code, run once per round for everybody in this process (every phone gets the identical true/false answer; a phone alone would do the same arithmetic)
const refStore = new ZG.RoundStore({}); const sigMemo = new Map(); export const sigStats = { checks: 0, shared: 0 };
const verify = (x) => { const k = x.round + ":" + x.signature + ":" + x.randomness; let v = sigMemo.get(k); if (v === undefined) { sigStats.checks++; v = !!refStore.verify(x); sigMemo.set(k, v); } else sigStats.shared++; return v; };
export const beaconStats = { fetched: 0, hits: 0, failed: 0 };
export const beaconAvail = new Map(); // round -> the moment (ms) the first good answer for that round reached this program: how late the public beacon itself was

const fetcher = async (url, init) => { // one real request per round per mirror for the whole crowd; each phone can still give up on its own (its own abort signal) without cancelling the others' request
  const latest = /\/latest$/.test(url) || /\/public$/.test(url); let hit = cache.get(url);
  const own = new Promise((_, rej) => { const sg = init?.signal; if (sg) { if (sg.aborted) rej(Object.assign(new Error("aborted"), { name: "AbortError" })); else sg.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }); } });
  own.catch(() => {});
  if (!hit || (latest && Date.now() - hit.t >= 2000)) {
    const p = (async () => { const r = await ufetch(url, { signal: AbortSignal.timeout(8000), dispatcher: beaconAgent }); const body = r.ok ? await r.json() : null; return { ok: r.ok, status: r.status, json: async () => body }; })();
    hit = { t: Date.now(), p }; cache.set(url, hit); beaconStats.fetched++;
    p.then((x) => { if (x.ok) { const m = /\/public\/(\d+)/.exec(url); if (m && !beaconAvail.has(Number(m[1]))) beaconAvail.set(Number(m[1]), Date.now()); } if (!x.ok && cache.get(url) === hit) cache.delete(url); }).catch(() => { beaconStats.failed++; if (cache.get(url) === hit) cache.delete(url); }); // only a good answer is kept: a round that is not published yet must be asked for again
  } else beaconStats.hits++;
  return Promise.race([hit.p, own]);
};


// at most 160 calls to our server at the same moment from this program, so the same few connections are reused (800 phones opening hundreds of new connections in the same instant is a property of this test program, not of a crowd of real phones)
let inflight = 0; const waitQ = [];
export const queueStats = { waits: 0, maxMs: 0, over500: 0 };
const slot = async () => { if (inflight < 160) { inflight++; return; } const t = performance.now(); await new Promise((r) => waitQ.push(r)); const w = performance.now() - t; queueStats.waits++; if (w > queueStats.maxMs) queueStats.maxMs = w; if (w > 500) queueStats.over500++; };
const release = () => { const n = waitQ.shift(); if (n) n(); else inflight--; };
export class Harness {
  constructor(BASE, { ipPool = Number(process.env.IP_POOL) || 60 } = {}) { this.BASE = BASE; if (/^https:\/\//.test(BASE)) globalThis.location = new URL(BASE); /* the real phone code then adds our own site as its last beacon route, as in a browser */ this.lat = []; this.calls = 0; this.fails = 0; this.failKinds = {}; this.ips = Array.from({ length: ipPool }, () => `10.${rnd(250)}.${rnd(250)}.${1 + rnd(250)}`); this.C = JSON.parse(readFileSync(PUB + "consent-text.json", "utf8")); }
  consent(k) { return { consent: { v: this.C.version, boxes: Object.keys(this.C[k]) } }; }
  /** one plain API call as the organizer's console does */
  async call(m, p, b, key, ip = "10.1.1.1") {
    const r = await gfetch(this.BASE + p, { method: m, headers: { "content-type": "application/json", ...(this.BASE.startsWith("https") ? {} : { "cf-connecting-ip": ip }), ...(key ? { "x-organizer": key } : {}) }, body: b ? JSON.stringify(b) : undefined, signal: AbortSignal.timeout(60000) });
    return { ok: r.ok, s: r.status, j: await r.json().catch(() => ({})) };
  }
}
const rnd = (n) => Math.floor(Math.random() * n);

/** a participant's phone */
export class NodePhone {
  constructor(H, eid, who, o = {}) {
    this.H = H; this.eid = eid; this.who = who; this.o = o; this.store = new Map(); this.ip = H.ips[rnd(H.ips.length)];
    this.timeline = []; this.lastLen = 0; this.react = o.react || [900, 4500]; this.claimMode = o.claim || "always"; this.errors = []; this.offlineUntil = 0; this.stopped = false;
    this.api = async (method, path, body) => {
      if (Date.now() < this.offlineUntil) throw new Error("offline");
      if (/\/join$/.test(path) && body) body = { ...body, ...H.consent("K4") };
      await slot(); const t0 = performance.now(); let r, status = 0;
      try { r = await gfetch(H.BASE + path, { method, headers: { "content-type": "application/json", ...(H.BASE.startsWith("https") ? {} : { "cf-connecting-ip": this.ip }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(30000) }); status = r.status; }
      catch (e) { release(); H.calls++; H.fails++; if ((H.logged = (H.logged || 0) + 1) <= 25) console.log(`  [call failed] ${method} ${path.slice(0, 60)} ${(e && e.name) || ''} ${(e && e.message) || ''} cause=${e && e.cause ? (e.cause.code || e.cause.message) : '-'} after ${Math.round(performance.now() - t0)}ms`); const cz = (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || "?"; const kk = `network ${method} ${path.replace(/[A-Z0-9-]{6,}/g, ":id").replace(/[?].*/, "").replace(/\d+/g, "n")} ${cz}`; H.failKinds[kk] = (H.failKinds[kk] || 0) + 1; throw new Error("offline"); }
      const ms = performance.now() - t0; H.lat.push(ms); H.calls++;
      let j = {}; try { j = await r.json(); } catch { /* not json */ } finally { release(); }
      if (status >= 500) { H.fails++; const k = `${method} ${path.replace(/[A-Z0-9-]{6,}/g, ":id").replace(/\d+/g, "n")} ${status}`; H.failKinds[k] = (H.failKinds[k] || 0) + 1; }
      if (!r.ok) throw Object.assign(new Error(j.error || "http " + status), { status, code: j.code, body: j });
      return j;
    };
    this.mk();
  }
  mk() {
    const store = { get: (k) => (this.store.has(k) ? this.store.get(k) : null), set: (k, v) => this.store.set(k, v) };
    this.rt = new ZG.PhoneRuntime(this.eid, { api: this.api, getPublic: async (url) => { const r = await gfetch(url, { cache: "no-store" }); if (!r.ok) throw Object.assign(new Error("http " + r.status), { status: r.status }); return r.json(); }, beacon: { fetcher }, verify, mono: () => performance.now(), store, ...(this.o.noEarlyEnd ? { noEarlyEnd: true } : {}) });
    if (!process.env.NOHOOK) this.rt.onProgress = () => { const n = this.rt.view().log.length; if (n !== this.lastLen) { if (n > this.lastLen) this.timeline.push({ t: Date.now(), n }); this.lastLen = n; this.newAt = Date.now(); this.react1 = this.react[0] + Math.random() * (this.react[1] - this.react[0]); this.pending = true; } }; // the number shows as soon as it is known, like the page
    if (this.o.light) this.rt.syncEngines = () => {}; // a light phone does not work out every winner of the game itself (in one test program that would be N x N ticket building): it follows the results the other phones report, as a phone does while its seat list is not here
  }
  /** the phone opens the link and joins (what the Join button does) */
  async open() { await this.rt.boot(); return this.rt.phase; }
  async join() { /* like the real page since 1.3.3: a join that got NO answer (timeout) is asked again, up to 3 more times, each at its own random moment; the first-attempt failures are counted in this.joinTimeouts */ const w = this.who; this.joinTimeouts = 0; for (let k = 0; k < 4; k++) { const ok = await this.rt.join(w.phone || "", w.name, undefined, w.empId); if (ok) return true; const err = String(this.rt.error || ""); if (!/Could not join|timed? ?out|fetch failed|abort/i.test(err) && k === 0 && err) return false; this.joinTimeouts++; await new Promise((r) => setTimeout(r, 2000 + Math.random() * 6000)); } return false; }
  /** closing the page and opening the same link again on the same phone: same device, same ticket */
  async reload() { this.mk(); await this.rt.boot(); this.lastLen = 0; }
  go() { this.stopped = false; this.loop(); }
  stop() { this.stopped = true; clearTimeout(this.t); }
  /** the check-in: when it opens the phone shows a 4-digit code; the person confirms name and number, types the code and presses Submit (a person takes 5 to 40 seconds) */
  async checkin() {
    const pid = this.rt.view().pid; if (!pid || this.present || Date.now() < (this.ckNext || 0)) return;
    this.ckNext = Date.now() + 4000 + rnd(3000);
    const device = this.store.get("ctz:device") || ""; const r = await this.api("GET", `/api/z/${this.eid}/checkin?pid=${encodeURIComponent(pid)}&device=${encodeURIComponent(device)}`).catch(() => null);
    if (!r) return; if (r.required === false || r.present) { this.present = true; return; }
    if (!r.open || !r.code) return;
    if (!this.ckAt) this.ckAt = Date.now() + 5000 + rnd(35000);
    if (Date.now() < this.ckAt) return;
    const x = await this.api("POST", `/api/z/${this.eid}/checkin`, { pid, device, code: r.code, confirmName: true, confirmMobile: true }).catch((e) => { this.errors.push("checkin " + e.message); return null; });
    if (x && x.present) { this.present = true; this.presentAt = Date.now(); }
  }
  async loop() {
    if (this.stopped) return;
    const t0 = Date.now();
    try {
      await this.checkin();
      if (!this.overSent && this.rt.phase === "ended" && Math.random() < 0.1) { this.overSent = true; const pid = this.rt.view().pid; if (pid) this.api("POST", `/api/z/${this.eid}/over`, { pid }).catch(() => {}); } // the phone page tells the server that the game is over (a few phones do; the report starts a few minutes after)
      const v = await this.rt.tick();
      const n = v.log.length;
      if (n !== this.lastLen) { if (n > this.lastLen) this.timeline.push({ t: Date.now(), n }); this.lastLen = n; this.newAt = Date.now(); this.react1 = this.react[0] + Math.random() * (this.react[1] - this.react[0]); this.pending = true; }
      if (this.pending && Date.now() - this.newAt > this.react1 && this.claimMode !== "never-tap") {
        this.pending = false;
        if (this.claimMode === "never") await this.rt.playAlong({ claim: false });
        else if (this.claimMode === "bogey") { await this.rt.playAlong({ claim: false }); const k = ZG.keysInPlay(this.rt.cfg.rewards).filter((x) => x !== "unlucky")[0]; if (k && !this.bogeyDone && Math.random() < 0.3) { this.bogeyDone = true; try { await this.rt.claim(k); } catch { /* counted */ } } else await this.rt.playAlong({ claim: true, tap: false }); }
        else await this.rt.playAlong({ claim: true });
      }
    } catch (e) { this.errors.push(String(e && e.message || e).slice(0, 100)); }
    if (!this.stopped) this.t = setTimeout(() => this.loop(), Math.max(50, 1000 - (Date.now() - t0)) + rnd(150));
  }
  view() { return this.rt.view(); }
}
