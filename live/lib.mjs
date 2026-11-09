// SMOKE10M LIVE driver, shared library (written 4 Nov 2026 by the live-driver builder; plain node, no packages needed).
// What it gives every game module:
//   - ctx.call(): ONE place that talks HTTP to the real site: timing, retry/backoff, a rate limit per site, the STOP file, a write-budget count, and a RECORD of every call
//     {game, feature, step, method, path, status, ms, message, state} that ends up in feature-table-<game>.json.
//   - test marking: every game id starts with SMK10M- and every game name with "SMOKE10M test" (the live gate prints the first 12 letters of the id, so SMK10M-xxxxx = ours).
//   - the commit of the site (GET /version.json) is captured and written into every result.
// Secrets: NEVER printed or stored. The organizer key lives only in memory; anything that looks like a key (ctk_/cta_/cth_/ctc_ + hex) is scrubbed from every stored text.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
// The runner secret (X-Runner-Key): the games honour the test sign-in, the owner test route and the join-guard skip ONLY when this header is present. Read from the environment or from runner.env (this folder, or its parent);
// never printed, never written to a run file or a log. Accepted file forms: a line X_RUNNER_KEY=... / RUNNER_KEY=..., or just the value alone on the first line.
const RUNNER_KEY = (() => {
  try {
    if (process.env.X_RUNNER_KEY) return process.env.X_RUNNER_KEY.trim();
    for (const f of [new URL("./runner.env", import.meta.url), new URL("../runner.env", import.meta.url), new URL("../../runner.env", import.meta.url)]) {
      if (!existsSync(f)) continue;
      const lines = readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      for (const l of lines) { const m = /^(?:export\s+)?(?:X_RUNNER_KEY|RUNNER_KEY)\s*=\s*"?([^"\s]+)"?$/.exec(l); if (m) return m[1]; }
      if (lines[0] && !lines[0].includes("=")) return lines[0];
    }
  } catch {}
  return "";
})();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const STOP_FILE = process.env.LIVE_STOP || join(HERE, "STOP");
export const GEN = 1692803367;
export const roundAt = (ms) => Math.floor((ms / 1000 - GEN) / 3) + 1;
export const roundMs = (r) => (GEN + (r - 1) * 3) * 1000;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha = (s) => createHash("sha256").update(s).digest("hex");
export const ID_PREFIX = "SMK10M-"; // 7 letters + 5 = 12: the gate prints id[:12], so the whole id is visible there
export const NAME_PREFIX = "SMOKE10M test";

/** The six games. d1 = database id for live_games_now_game.py (tambola's is built into live_games_now.py). callSeconds = the gap the create call sends.
 *  platformKeyFile: where the owner key lives on the BOSS laptop (name of a file only; its content is never printed); null = NOT FOUND, ask the BOSS. */
export const GAMES = {
  tambola: { label: "Corporate Tambola", site: "https://housie.corporatetambola.com", d1: null, callSeconds: 12, platformKeyFile: "C:/ct/tambola/config/platform-key.txt", ownerKeyEnv: "OWNER_KEY_TAMBOLA" },
  bingo: { label: "Corporate Bingo", site: "https://bingo.corporatetambola.com", d1: "f2d1ed1b-77cd-401a-af4c-4c02724688ef", callSeconds: 12, platformKeyFile: null, ownerKeyEnv: "OWNER_KEY_BINGO" },
  tictactoe: { label: "Corporate Tic Tac Toe", site: "https://tictactoe.corporatetambola.com", d1: "6f1d9846-7716-4209-8cad-85ed83dc8f1f", callSeconds: 9, platformKeyFile: null, ownerKeyEnv: "OWNER_KEY_TICTACTOE" },
  snakes: { label: "Corporate Snakes and Ladders", site: "https://snakes.corporatetambola.com", d1: "3ed0dc2c-c3ab-489c-9e99-71c3644ff30a", callSeconds: 20, platformKeyFile: null, ownerKeyEnv: "OWNER_KEY_SNAKES" },
  luck: { label: "Corporate Luck by Chance", site: "https://luck.corporatetambola.com", d1: "c98bedfe-6de2-40bc-bcd8-ba79f0ef68c6", callSeconds: 9, platformKeyFile: null, ownerKeyEnv: "OWNER_KEY_LUCK" },
  luckydraw: { label: "Corporate Lucky Draw", site: "https://luckydraw.corporatetambola.com", d1: "aa913d0a-24e2-4bd2-a9bd-27e7186a24bd", callSeconds: 12, platformKeyFile: "C:/ct/test-sites/luckydraw/config/live-secrets.txt", ownerKeyEnv: "OWNER_KEY_LUCKYDRAW" },
};

// ---------- scrub: nothing that looks like a key or a token is ever written down ----------
const KEYRE = /\b(?:ct[kahcp]_[0-9a-f]{20,}|[0-9a-f]{48,})\b/gi;
export const scrub = (s) => String(s ?? "").replace(KEYRE, "<key>");
const short = (s, n = 140) => scrub(s).replace(/\s+/g, " ").slice(0, n);

// ---------- cooperative controls ----------
export class StopError extends Error { constructor(why) { super(why || "STOP"); this.name = "StopError"; } }
export const stopRequested = () => existsSync(STOP_FILE);
export const checkStop = () => { if (stopRequested()) throw new StopError("STOP file found: " + STOP_FILE); };

/** Token bucket per site, shared by every run in this process (so --parallel K never means K times the pace). */
const buckets = new Map();
export async function pace(site, rps) {
  if (!rps || rps <= 0) return;
  const b = buckets.get(site) || { next: 0 }; buckets.set(site, b);
  const gap = 1000 / rps, now = Date.now(); const at = Math.max(b.next, now); b.next = at + gap;
  if (at > now) await sleep(at - now);
}

/** Estimated rows written to the site's database, per call kind (the site refuses with 503 "busy" for EVERYBODY when its daily budget of 80,000 is used up: see the report). */
const WRITE_COST = [[/\/join$/, 9], [/\/claims$/, 2], [/\/vote$/, 3], [/\/(over|leave)$/, 4], [/\/publish$/, 4], [/\/people$/, 2], [/\/throw$/, 1], [/\/press$/, 2], [/\/announce$/, 1], [/\/control$/, 1], [/\/api\/z$/, 2]];
export const budget = { day: "", writes: 0, joins: 0, cap: Infinity, joinCap: Infinity, file: null };
const utcDay = () => new Date().toISOString().slice(0, 10);
export function budgetInit({ file, cap, joinCap }) {
  budget.file = file; budget.cap = cap || Infinity; budget.joinCap = joinCap || Infinity;
  try { const j = JSON.parse(readFileSync(file, "utf8")); if (j.day === utcDay()) { budget.day = j.day; budget.writes = j.writes || 0; budget.joins = j.joins || 0; return; } } catch { /* new day or no file */ }
  budget.day = utcDay(); budget.writes = 0; budget.joins = 0;
}
function budgetAdd(method, path) {
  if (budget.day !== utcDay()) { budget.day = utcDay(); budget.writes = 0; budget.joins = 0; }
  if (method === "GET") return;
  const p = path.split("?")[0]; const hit = WRITE_COST.find(([re]) => re.test(p)); budget.writes += hit ? hit[1] : 1; if (/\/join$/.test(p)) budget.joins++;
  if (budget.file && (budget.writes % 25 === 0)) { try { writeFileSync(budget.file, JSON.stringify({ day: budget.day, writes: budget.writes, joins: budget.joins })); } catch { /* ok */ } }
}
export const budgetLeft = () => ({ writes: budget.cap - budget.writes, joins: budget.joinCap - budget.joins });
export const budgetSave = () => { if (budget.file) try { writeFileSync(budget.file, JSON.stringify({ day: budget.day, writes: budget.writes, joins: budget.joins })); } catch { /* ok */ } };
/** Waits (checking STOP every 30 s) until the daily allowance has room for `needJoins` joins and `needWrites` writes; the day rolls over at 00:00 UTC. */
export async function budgetWait(needJoins, needWrites, say = () => {}) {
  for (;;) {
    checkStop();
    if (budget.day !== utcDay()) { budget.day = utcDay(); budget.writes = 0; budget.joins = 0; }
    const l = budgetLeft(); if (l.joins >= needJoins && l.writes >= needWrites) return;
    say(`daily allowance used (writes ${budget.writes}/${budget.cap}, joins ${budget.joins}/${budget.joinCap}); waiting for the next UTC day`);
    await sleep(30000);
  }
}

// ---------- the HTTP engine ----------
let undiciAgent = null, undiciFetch = null, httpReady = false;
async function initHttp() {
  if (httpReady) return; httpReady = true;
  try {
    if (process.env.LIVE_PUBLIC_DNS === "1") { const dns = await import("node:dns"); dns.setServers(["1.1.1.1", "8.8.8.8"]); const cache = new Map();
      const lookup = (host, opts, cb) => { const h = cache.get(host); const done = (arr) => (opts && opts.all ? cb(null, arr.map((x) => ({ address: x, family: 4 }))) : cb(null, arr[Math.floor(Math.random() * arr.length)], 4));
        if (h && Date.now() - h.t < 300000) return done(h.a); dns.resolve4(host, (e, a) => { if (!e && a?.length) { cache.set(host, { t: Date.now(), a }); return done(a); } if (h) return done(h.a); dns.lookup(host, opts, cb); }); };
      const u = await import("undici"); undiciAgent = new u.Agent({ keepAliveTimeout: 30000, connections: 64, connect: { lookup } }); undiciFetch = u.fetch; }
  } catch { undiciAgent = null; undiciFetch = null; }
}
const rawFetch = async (url, init) => { await initHttp(); if (undiciAgent) return undiciFetch(url, { ...init, dispatcher: undiciAgent }); return fetch(url, init); };

/** Words a person can read for the common codes (the site's own sentence is kept next to it). */
const PLAIN = { "consent-required": "the box was not ticked / page out of date", "device-used": "this phone already holds a ticket", "other-phone": "ticket belongs to another phone", full: "game full", busy: "site busy", "invite-full": "invitation used up (waiting)", waiting: "waiting for approval", removed: "removed by organizer", "claim-late": "claim too late", late: "too late", "game-running": "game is running", "start-pending": "start time not set", "did-not-start": "game did not start", locked: "payment not complete", cancelled: "cancelled" };

/** One game run's context. */
export function makeCtx({ game, site, runId, kind = "game", dry = false, mock = null, rps = 6, outDir = ".", logEvery = 0, say = () => {} }) {
  const G = GAMES[game];
  const ctx = {
    game, site: site || G.site, runId, kind, dry, outDir, say, rps,
    commit: null, versionJson: null, consentVersion: "2026-11-01", key: null, ownerKey: null, keys: {}, // keys: {host, cohost} in memory only
    entries: [], agg: new Map(), t0: Date.now(), errors: [], notes: [], stats: { calls: 0, retries: 0, netErrors: 0, s5xx: 0, s429: 0 },
    absent: {}, // feature -> reason it does not exist in this game
  };
  const sess = { token: null, pending: null, signins: 0 };
  ctx.session = sess;
  const doFetch = dry && mock ? mock : rawFetch;

  /** Records one finished call (a row of the response table) and the aggregate for its (feature, step, status). */
  function record(e) {
    ctx.stats.calls++;
    if (ctx.entries.length < 600) ctx.entries.push(e);
    const k = e.feature + "\u0001" + e.step + "\u0001" + (e.status ?? "-");
    let a = ctx.agg.get(k); if (!a) { a = { feature: e.feature, step: e.step, status: e.status, n: 0, ms: [], msg: e.message, state: e.state, method: e.method, path: e.path, expected: e.expected }; ctx.agg.set(k, a); }
    a.n++; if (e.ms != null && a.ms.length < 400) a.ms.push(e.ms); if (e.state && !a.state) a.state = e.state; if (e.message && !a.msg) a.msg = e.message;
  }
  ctx.note = (feature, step, message, state) => { record({ ts: Date.now(), game, feature, step, method: "-", path: "-", status: null, ms: null, message: short(message, 200), state: state ? short(state, 200) : "", expected: true, run: runId }); };
  ctx.setState = (text) => { const e = ctx.entries[ctx.entries.length - 1]; if (e) { e.state = short(text, 200); const k = e.feature + "\u0001" + e.step + "\u0001" + (e.status ?? "-"); const a = ctx.agg.get(k); if (a && !a.state) a.state = e.state; } };
  ctx.declareAbsent = (feature, reason) => { ctx.absent[feature] = reason; };

  // Sign-in reuse, per game and per organizer role (BOSS, 5 Nov). OFF unless LIVE_SIGNIN_REUSE_GAMES lists this game.
  // A token is cached per game (never shared across games) and reused for LIVE_SIGNIN_TTL_MS (default 3 h).
  // A forced sign-in (after "Not allowed") always goes to the site and refreshes this game's cache.
  // Games are listed in env LIVE_SIGNIN_REUSE_GAMES or in the control file t99/SIGNIN-REUSE (one list, comma separated; read on every run, no restart needed).
  const reuseFile = join(HERE, "t99", "SIGNIN-REUSE");
  const fromFile = existsSync(reuseFile) ? readFileSync(reuseFile, "utf8") : "";
  const reuseGames = (String(process.env.LIVE_SIGNIN_REUSE_GAMES || "") + "," + fromFile).split(",").map((x) => x.trim()).filter(Boolean);
  const reuseOn = reuseGames.includes(ctx.game);
  const SIGNIN_TTL_MS = Number(process.env.LIVE_SIGNIN_TTL_MS || 20 * 3600 * 1000); // 20 h (5 Nov): a day of reuse per game and machine, keeps fresh sign-ins under the 30-a-day limit
  const SIGNIN_CACHE = join(HERE, "t99", `signin-cache-${ctx.game}-org.json`);
  async function signIn(force = false) {
    if (sess.token && !force) return sess.token;
    if (reuseOn && !force) {
      try {
        const c = JSON.parse(readFileSync(SIGNIN_CACHE, "utf8"));
        if (c.token && c.game === ctx.game && Date.now() - c.at < SIGNIN_TTL_MS) { sess.token = c.token; return sess.token; }
      } catch {}
    }
    if (sess.pending) return sess.pending;
    sess.pending = (async () => {
      if (sess.signins >= Number(process.env.LIVE_MAX_SIGNINS || 8)) throw new Error("sign-in limit of this process reached (the site allows 30 per address per day and keeps only the latest 3 keys)");
      sess.signins++;
      const r = await ctx.call("signin", "test-login", "POST", "/api/auth/verify", { body: { email: process.env.T99_ORG_EMAIL || "demo1@xyz.in", code: "123456" }, as: null });
      if (r.s !== 200 || !r.j?.token) throw new Error("test sign-in failed: status " + r.s + " " + short(r.j?.error));
      sess.token = r.j.token;
      if (reuseOn) { try { writeFileSync(SIGNIN_CACHE, JSON.stringify({ token: sess.token, game: ctx.game, at: Date.now() })); } catch {} }
      return sess.token;
    })();
    try { return await sess.pending; } finally { sess.pending = null; }
  }
  ctx.signIn = signIn;

  /** ctx.call(feature, step, method, path, opts)
   *  opts: body, as ("org" default | "host" | "cohost" | "owner" | null = no key), expect (array of statuses that count as the EXPECTED answer; others are flagged), tries (retry count for network/5xx/429), timeout, quiet.
   *  Returns {s, j, ms, ok, expected, text}. Never throws on HTTP errors; throws StopError when the STOP file exists. */
  ctx.call = async (feature, step, method, path, opts = {}) => {
    checkStop();
    const as = opts.as === undefined ? "org" : opts.as;
    let key = null;
    if (as === "org") key = sess.token || (path === "/api/auth/verify" ? null : await signIn());
    else if (as === "host") key = ctx.keys.host; else if (as === "cohost") key = ctx.keys.cohost; else if (as === "owner") key = ctx.ownerKey;
    const headers = { "content-type": "application/json", "user-agent": "smoke10m-live/1 (" + (process.env.T99_UA === "mobile" ? "Linux; Android 14; ONEPLUS; Mobile Safari; " : process.env.T99_UA === "desktop" ? "Windows NT 10.0; Win64; Desktop; " : "") + "owner-approved test; marked SMK10M)", "x-smoke10m": String(runId).slice(0, 40), ...(key ? { "x-organizer": key } : {}), ...(RUNNER_KEY ? { "x-runner-key": RUNNER_KEY } : {}), ...(opts.headers || {}) };
    const url = ctx.site + path; const maxTries = opts.tries ?? 3; let last = null, retried = 0; let relogged = false;
    for (let attempt = 1; attempt <= maxTries + 1; attempt++) {
      if (attempt > 1) { ctx.stats.retries++; retried++; await sleep(Math.min(20000, 1500 * 2 ** (attempt - 2)) + Math.random() * 800); checkStop(); }
      await pace(ctx.site, ctx.rps); budgetAdd(method, path);
      const t0 = performance.now(); let s = 0, text = "", j = null, err = null;
      try {
        const r = await doFetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(opts.timeout || 30000), cache: "no-store" });
        s = r.status; text = await r.text().catch(() => ""); try { j = text ? JSON.parse(text) : null; } catch { j = null; }
      } catch (e) { err = e; ctx.stats.netErrors++; }
      const ms = Math.round(performance.now() - t0); last = { s, j, ms, text, err };
      if (err) { if (attempt <= maxTries) continue; break; }
      if (s === 429) ctx.stats.s429++; if (s >= 500) ctx.stats.s5xx++;
      if ((s === 429 || s === 502 || s === 503 || s === 504) && attempt <= maxTries && !opts.noRetry) continue;
      // 4 Nov: the organizer's test sign-in token stops working after a while ('Not allowed' on the organizer's own routes, seen in ~45 of 104 Tambola games late in a long run): sign in again once and repeat the call.
      if (as === "org" && (s === 401 || s === 403) && /Not allowed|sign in/i.test(String(j?.error || "")) && !relogged && path !== "/api/auth/verify") { relogged = true; try { sess.token = null; headers["x-organizer"] = await signIn(true); ctx.stats.relogins = (ctx.stats.relogins || 0) + 1; attempt--; continue; } catch { /* keep the original answer */ } }
      break;
    }
    const { s, j, ms, text, err } = last;
    const expected = opts.expect ? opts.expect.includes(s) : (s >= 200 && s < 300);
    const code = j?.code ? PLAIN[j.code] || j.code : "";
    const msg = err ? "NETWORK: " + (err.cause?.code || err.name || "error") + " " + short(err.message, 60) : (j?.error ? short(j.error) : (j?.message ? short(j.message) : (s >= 200 && s < 300 ? "ok" : short(text, 80))));
    const e = { ts: Date.now(), game, feature, step, method, path: scrub(path).replace(new RegExp(ID_PREFIX + "[A-Za-z0-9]+", "g"), ":eid").replace(/\d{6,}x[0-9a-z]+/g, ":pid"), status: err ? 0 : s, ms, message: (code && !msg.includes(code) ? `[${code}] ` : "") + msg, state: "", expected, tries: retried + 1, run: runId };
    if (!opts.quiet) record(e);
    if (!expected && !opts.quiet) ctx.errors.push(`${feature}/${step} ${method} ${e.path} -> ${e.status} ${short(e.message, 90)}`);
    return { s: err ? 0 : s, j, ms, ok: !err && s >= 200 && s < 300, expected, text };
  };

  ctx.captureVersion = async () => {
    const r = await ctx.call("version", "version.json", "GET", "/version.json", { as: null, tries: 4 }); // a few retries, a few seconds apart; if all fail it stays "unreachable", never a guessed commit
    ctx.versionJson = r.j; ctx.commit = r.j?.commit || r.j?.sha || r.j?.version || (r.s === 200 ? "unknown-shape" : "unreachable"); return ctx.commit;
  };
  return ctx;
}

// ---------- ids, people, times ----------
export const newEid = () => ID_PREFIX + randomBytes(4).toString("hex").slice(0, 5); // exactly 12 characters
export const deviceOf = (runId, i) => sha("dev|" + runId + "|" + i).slice(0, 32);
export const phoneOf = (runSalt, i) => "9" + String(Number(runSalt) % 100).padStart(2, "0") + String(1000000 + i).slice(1).padStart(7, "0"); // 10 digits, starts with 9
export const nameOf = (game, i) => `SMOKE10M ${game} P${String(i).padStart(3, "0")}`;
export const seatOfPid = (pid) => { const m = /^(\d{1,6})x/.exec(String(pid || "")); return m ? Number(m[1]) : null; };
export const consentBody = (ctx, kind) => ({ v: ctx.consentVersion, boxes: kind === "K1" || kind === "K4" ? ["A", "B"] : ["A"] }); // K1 organizer publish, K4 person join (A,B); K5 host/co-host role, K6 organizer adds people (A)

/** Percentiles of a list of numbers. */
export function pct(a, p) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; }

/** Turns a ctx into the JSON of one run. */
export function runJson(ctx, extra = {}) {
  const rows = [...ctx.agg.values()].map((a) => ({ feature: a.feature, step: a.step, status: a.status, n: a.n, message: a.msg, state: a.state || "", ms: { p50: pct(a.ms, 50), p95: pct(a.ms, 95), max: a.ms.length ? Math.max(...a.ms) : null }, expected: a.expected, method: a.method, path: a.path }));
  return { run: ctx.runId, game: ctx.game, kind: ctx.kind, site: ctx.site, commit: ctx.commit, version: ctx.versionJson, startedAt: new Date(ctx.t0).toISOString(), seconds: Math.round((Date.now() - ctx.t0) / 1000), stats: ctx.stats, absent: ctx.absent, notes: ctx.notes, unexpected: ctx.errors.slice(0, 80), rows, ...extra };
}
export function writeJson(file, obj) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(obj, null, 1)); }
export function loadOwnerKey(game) {
  const G = GAMES[game]; const env = process.env[G.ownerKeyEnv]; if (env) return env.trim();
  if (G.platformKeyFile) { try { const t = readFileSync(G.platformKeyFile, "utf8"); const m = /ORGANIZER_SECRET\s*=\s*(\S+)/.exec(t); if (m) return m[1].trim(); const first = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0]; if (first && !first.includes("=")) return first; } catch { /* not on this machine */ } }
  return null;
}
