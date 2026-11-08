// Signed control messages (Pause / Resume / Extend / Next / Go) exactly as the organizer console sends them: the site's own /control.js (TBControl) run in node with a tiny in-memory
// IndexedDB, so the signing key is created once per game by ensureKey() and kept in this process. control.js is fetched from the LIVE site (so it is always the current one);
// vendor/assets/control.js (copy of the 3 Nov snapshot) is only the fallback. Used by every game except Tic Tac Toe's own pause (that game has /ttt/pause).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { HERE } from "./lib.mjs";
import { join } from "node:path";

let loaded = null;
function stubs() {
  const store0 = new Map();
  globalThis.window = globalThis; globalThis.self = globalThis;
  globalThis.localStorage = { getItem: (k) => store0.get(k) ?? null, setItem: (k, v) => store0.set(k, String(v)), removeItem: (k) => store0.delete(k) };
  const stores = new Map(); const later = (r, v) => { setTimeout(() => { r.result = v; r.onsuccess && r.onsuccess(); }, 0); return r; };
  const db = { createObjectStore: (n) => { if (!stores.has(n)) stores.set(n, new Map()); }, transaction: (n) => ({ objectStore: () => ({ get: (k) => later({}, stores.get(n)?.get(k)), put: (v, k) => { stores.get(n).set(k, v); const r = {}; setTimeout(() => { r.result = undefined; r.onsuccess && r.onsuccess(); }, 0); return r; } }) }) };
  let created = false; globalThis.indexedDB = { open: () => { const r = { result: db }; setTimeout(() => { if (!created) { created = true; r.onupgradeneeded && r.onupgradeneeded(); } r.onsuccess && r.onsuccess(); }, 0); return r; } };
}

/** Loads TBControl once per process. Returns {ok, from, reason}. */
export async function loadControl(ctx) {
  if (loaded) return loaded;
  let code = null, from = "";
  if (!ctx.dry) {
    try { const r = await fetch(ctx.site + "/control.js", { signal: AbortSignal.timeout(20000) }); if (r.ok) { code = await r.text(); from = "live " + ctx.site + "/control.js"; } } catch { /* fall back */ }
  }
  if (!code) { try { code = readFileSync(join(HERE, "vendor", "assets", "control.js"), "utf8"); from = "vendor copy (3 Nov snapshot)"; } catch { /* none */ } }
  if (!code) return (loaded = { ok: false, reason: "control.js not found" });
  try { stubs(); vm.runInThisContext(code, { filename: "control.js" }); } catch (e) { return (loaded = { ok: false, reason: "control.js did not load: " + String(e).slice(0, 100) }); }
  if (!globalThis.TBControl) return (loaded = { ok: false, reason: "TBControl missing after load" });
  return (loaded = { ok: true, from });
}

const cfgOf = (ctx) => ({ token: ctx.session.token, base: ctx.site, prefix: "/api/z" });

/** Registers the organizer's signing key for the game (what the console does at create). Records one table row. */
export async function ensureControlKey(ctx, eid, feature = "pause-resume") {
  const L = await loadControl(ctx);
  if (!L.ok) { ctx.note(feature, "control-key", "NOT RUN: " + L.reason); return { ok: false, reason: L.reason }; }
  const t0 = Date.now();
  try {
    const k = await globalThis.TBControl.ensureKey(eid, cfgOf(ctx));
    ctx.note(feature, "control-key", k.ok ? `signing key registered (${Date.now() - t0} ms, script from ${L.from})` : "key refused: " + (k.reason || "?"), k.ok ? "" : "pause not possible");
    return k;
  } catch (e) { ctx.note(feature, "control-key", "error: " + String(e).slice(0, 120)); return { ok: false, reason: String(e) }; }
}

/** Sends one signed action (go | pause | resume | extend | next | stop ...). The row records the HTTP status the site answered and how long it took. */
export async function sendControl(ctx, eid, action, feature, step, extra0 = {}) {
  const { _expect, ...extra } = extra0; const okSet = _expect || [200];
  const L = await loadControl(ctx);
  if (!L.ok) { ctx.note(feature, step, "NOT RUN: " + L.reason); return { status: 0, data: {} }; }
  checkStop2();
  const t0 = performance.now();
  try {
    const r = await globalThis.TBControl.publish(eid, cfgOf(ctx), action, extra);
    const ms = Math.round(performance.now() - t0);
    const msg = r.status === 200 ? `${action} accepted (seq ${r.data?.seq ?? "?"}${r.data?.duplicate ? ", duplicate" : ""})` : String(r.data?.error || "refused").slice(0, 140);
    ctx.stats.calls++; ctx.entries.push({ ts: Date.now(), game: ctx.game, feature, step, method: "POST", path: "/api/z/:eid/control", status: r.status, ms, message: msg, state: "", expected: okSet.includes(r.status), tries: 1, run: ctx.runId });
    const k = feature + "\u0001" + step + "\u0001" + r.status; let a = ctx.agg.get(k); if (!a) { a = { feature, step, status: r.status, n: 0, ms: [], msg, state: "", method: "POST", path: "/api/z/:eid/control", expected: okSet.includes(r.status) }; ctx.agg.set(k, a); } a.n++; a.ms.push(ms);
    if (!okSet.includes(r.status)) ctx.errors.push(`${feature}/${step} control ${action} -> ${r.status} ${msg}`);
    return r;
  } catch (e) { ctx.note(feature, step, `${action} failed: ${String(e).slice(0, 120)}`); return { status: 0, data: {}, error: String(e) }; }
}
import { stopRequested, StopError } from "./lib.mjs";
function checkStop2() { if (stopRequested()) throw new StopError("STOP"); }
