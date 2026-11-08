// SMOKE10M LIVE orchestrator.
//   node live/run.mjs <game> --organizers N --games N --players P --parallel K --out DIR [--from N] [--play short|full] [--runtime N] [--lead SEC] [--rps R]
//                     [--write-cap W] [--join-cap-day J] [--gate-file F] [--gate-max-age MIN] [--dry] [--speed X] [--no-gate] [--merge-only]
// game = tambola | bingo | tictactoe | snakes | luck | luckydraw.   One JSON per run in DIR/runs/, feature-table-<game>.json + counts-<game>.json in DIR.
// Exit codes: 0 done, 2 bad arguments, 3 pre-flight refused (a real customer game is running / gate file missing or stale), 4 STOP file found.
// Safety: STOP file (live/STOP) is checked before every call; at most 6 games at once per site (default 2); every game id starts SMK10M-; day budget of writes and joins per site.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GAMES, HERE, StopError, budget, budgetInit, budgetSave, budgetWait, loadOwnerKey, makeCtx, pct, runJson, sleep, stopRequested, writeJson } from "./lib.mjs";
import { runFullGame, runJourney } from "./scenario.mjs";

const argv = process.argv.slice(2);
const game = argv[0];
const opt = (k, d) => { const i = argv.indexOf("--" + k); if (i < 0) return d; const v = argv[i + 1]; return v === undefined || v.startsWith("--") ? true : v; };
const num = (k, d) => Number(opt(k, d));
if (!GAMES[game]) { console.error("usage: node live/run.mjs <tambola|bingo|tictactoe|snakes|luck|luckydraw> --organizers N --games N --players P --parallel K --out DIR"); process.exit(2); }
const O = {
  organizers: num("organizers", 0), games: num("games", 0), players: num("players", 100), parallel: num("parallel", 2), out: String(opt("out", join(HERE, "out", game))), from: num("from", 1),
  play: String(opt("play", "short")), runtime: num("runtime", 0), lead: num("lead", 900), rps: num("rps", 6), writeCap: num("write-cap", 70000), joinCap: num("join-cap-day", 2800),
  gateFile: String(opt("gate-file", join(HERE, "gate-status.json"))), gateAge: num("gate-max-age", 15), conc: num("conc", 6), pollSecs: num("poll-secs", 0), dry: !!opt("dry", false), speed: num("speed", 30), noGate: !!opt("no-gate", false), mergeOnly: !!opt("merge-only", false),
};
if (!(O.parallel >= 1 && O.parallel <= 6)) { console.error("--parallel must be 1..6 (hard cap per site)"); process.exit(2); }
if (O.players < 2 || O.players > 1200) { console.error("--players must be 2..1200"); process.exit(2); }
if (O.noGate && !O.dry && process.env.LIVE_ALLOW_NO_GATE !== "1") { console.error("--no-gate is only for --dry (or LIVE_ALLOW_NO_GATE=1 set by the BOSS)"); process.exit(2); }
const G = GAMES[game];
const say = (t) => console.log(new Date().toISOString().slice(11, 19) + " " + t);
const pad = (n) => String(n).padStart(3, "0");
const gameMod = (await import(`./games/${game}.mjs`)).default;

// ---------- dry: accelerated clock and the in-memory site; nothing leaves this process ----------
if (O.dry) {
  const mock = (await import("./mock.mjs")).default; globalThis.fetch = mock;
  const t0 = Date.now(), p0 = performance.now(), X = O.speed, realNow = Date.now.bind(Date), realSet = globalThis.setTimeout;
  Date.now = () => t0 + (realNow() - t0) * X; globalThis.setTimeout = (f, ms, ...a) => realSet(f, (ms || 0) / X, ...a);
  void p0;
}

mkdirSync(join(O.out, "runs"), { recursive: true });

// ---------- pre-flight ----------
function preflight() {
  if (stopRequested()) return { ok: false, code: 4, why: "STOP file exists" };
  if (O.dry || O.noGate) return { ok: true, why: "dry/no-gate" };
  if (existsSync(join(HERE, "HOLD"))) return { ok: false, code: 3, why: "HOLD file present (a release is using the gate): no new batch starts; the queue retries every 5 minutes" };
  let g; try { g = JSON.parse(readFileSync(O.gateFile, "utf8")); } catch { return { ok: false, code: 3, why: `gate file ${O.gateFile} missing: run gate-watch.mjs on the BOSS laptop and gate-push.sh` }; }
  const age = (Date.now() - Date.parse(g.at)) / 60000; if (!(age <= O.gateAge)) return { ok: false, code: 3, why: `gate file is ${Math.round(age)} min old (limit ${O.gateAge})` };
  const e = g.games?.[game]; if (!e || e.error) return { ok: false, code: 3, why: `gate has no clean answer for ${game}: ${e?.error || "missing"}` };
  if (e.others > 0) return { ok: false, code: 3, why: `${e.others} real (non-SMK10M) game(s) in the live window for ${game}: ${(e.otherRows || []).slice(0, 3).join(" | ")}` };
  return { ok: true, why: `gate ${Math.round(age)} min old: 0 real games, ${e.ours ?? 0} of ours` };
}
let pf = preflight();
say(`pre-flight: ${pf.ok ? "OK" : "REFUSED"} (${pf.why})`);
if (!pf.ok && !O.mergeOnly) process.exit(pf.code || 3);

budgetInit({ file: join(O.out, "budget.json"), cap: O.writeCap, joinCap: O.joinCap });

// ---------- the work list ----------
const tasks = [];
for (let k = 0; k < O.organizers; k++) tasks.push({ kind: "journey", id: `${game}-org-${pad(O.from + k)}` });
for (let k = 0; k < O.games; k++) tasks.push({ kind: "game", id: `${game}-game-${pad(O.from + k)}` });
const done = (id) => existsSync(join(O.out, "runs", `run-${id}.json`));
const todo = tasks.filter((t) => !done(t.id));
say(`${game}: ${tasks.length} runs asked (${O.organizers} organizer journeys + ${O.games} games of ${O.players}), ${tasks.length - todo.length} already done, ${todo.length} to do, parallel ${O.parallel}${O.dry ? ", DRY (no network)" : ""}`);

let stopped = false, finished = 0;
async function runTask(t) {
  if (stopped) return;
  if (stopRequested()) { stopped = true; return; }
  // the day budget: a game of P people costs about 9 rows per join + the rest of the steps
  await budgetWait(t.kind === "game" ? O.players + 20 : 12, t.kind === "game" ? O.players * 9 + 400 : 200, say).catch((e) => { if (e instanceof StopError) stopped = true; });
  if (stopped) return;
  const pf2 = O.dry ? pf : preflight(); if (!pf2.ok && !O.dry) { say(`${t.id}: pre-flight refused now (${pf2.why}); stopping`); stopped = true; return; }
  const ctx = makeCtx({ game, runId: t.id, kind: t.kind, dry: O.dry, mock: O.dry ? globalThis.fetch : null, rps: O.rps, outDir: O.out, say });
  ctx.absent = { ...(gameMod.absent || {}) }; ctx.ownerKey = loadOwnerKey(game);
  const base = { dry: O.dry, kind: t.kind, players: t.kind === "game" ? O.players : 6 };
  let S = null, outcome = "crashed", err = "";
  try {
    const o = { players: t.kind === "game" ? O.players : 6, callSeconds: G.callSeconds, play: O.play, runtime: O.runtime, leadSec: O.lead, conc: O.conc, pollSecs: O.pollSecs };
    S = t.kind === "journey" ? await runJourney(ctx, gameMod, o) : await runFullGame(ctx, gameMod, o);
    outcome = S.outcome || "done";
  } catch (e) { if (e instanceof StopError) { outcome = "stopped"; stopped = true; } else { outcome = "crashed"; err = String(e && e.stack || e).slice(0, 400); } }
  const j = runJson(ctx, { outcome, error: err, ...base, eid: S?.eid, joined: S?.joined ?? 0, totalSeenByOrganizer: S?.totalSeen ?? null, paid: S?.paid ?? null, zero: S?.zero ?? null, ended: !!S?.ended, cancelled: !!S?.cancelled, erased: !!S?.erased, budgetAfter: { writes: budget.writes, joins: budget.joins } });
  writeJson(join(O.out, "runs", `run-${t.id}.json`), j); budgetSave(); finished++;
  say(`${t.id}: ${outcome}; ${ctx.stats.calls} calls, ${ctx.errors.length} unexpected answers, ${S?.joined ?? 0} joined, ${j.seconds}s`);
}
async function worker(queue) { for (;;) { const t = queue.shift(); if (!t || stopped) return; await runTask(t); } }
if (!O.mergeOnly && todo.length) { const q = [...todo]; await Promise.all(Array.from({ length: Math.min(O.parallel, q.length) }, () => worker(q))); }

// ---------- merge: one feature-by-feature table + the counts ----------
function merge() {
  const dir = join(O.out, "runs"); const files = readdirSync(dir).filter((f) => f.startsWith("run-") && f.endsWith(".json"));
  const feats = new Map(); const absent = { ...(gameMod.absent || {}) }; const commits = new Set();
  const cnt = { game, site: G.site, runs: files.length, journeys: 0, games: 0, outcomes: {}, calls: 0, retries: 0, netErrors: 0, s5xx: 0, s429: 0, joined: 0, unexpectedTotal: 0, unexpectedTop: {}, cancelled: 0, ended: 0, erased: 0, zeroPaid: 0, zeroNotPaid: 0, dryRuns: 0 };
  for (const f of files) {
    let r; try { r = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    if (r.commit) commits.add(r.commit); Object.assign(absent, r.absent || {});
    cnt[r.kind === "game" ? "games" : "journeys"]++; cnt.outcomes[r.outcome] = (cnt.outcomes[r.outcome] || 0) + 1;
    cnt.calls += r.stats?.calls || 0; cnt.retries += r.stats?.retries || 0; cnt.netErrors += r.stats?.netErrors || 0; cnt.s5xx += r.stats?.s5xx || 0; cnt.s429 += r.stats?.s429 || 0; cnt.joined += r.joined || 0;
    cnt.cancelled += r.cancelled ? 1 : 0; cnt.ended += r.ended ? 1 : 0; cnt.erased += r.erased ? 1 : 0; cnt.dryRuns += r.dry ? 1 : 0;
    if (r.paid === true) cnt.zeroPaid++; else if (r.paid === false) cnt.zeroNotPaid++;
    for (const u of r.unexpected || []) { cnt.unexpectedTotal++; const k = u.replace(/\d+/g, "#").slice(0, 110); cnt.unexpectedTop[k] = (cnt.unexpectedTop[k] || 0) + 1; }
    for (const row of r.rows || []) {
      let F = feats.get(row.feature); if (!F) feats.set(row.feature, (F = new Map()));
      const k = row.step + "\u0001" + row.status; let a = F.get(k);
      if (!a) F.set(k, (a = { step: row.step, status: row.status, n: 0, runs: 0, message: row.message, state: row.state, expected: row.expected, method: row.method, path: row.path, p50s: [], p95s: [], max: 0 }));
      a.n += row.n; a.runs++; if (!a.state && row.state) a.state = row.state; if (row.ms?.p50 != null) a.p50s.push(row.ms.p50); if (row.ms?.p95 != null) a.p95s.push(row.ms.p95); a.max = Math.max(a.max, row.ms?.max || 0); if (row.expected === false) a.expected = false;
    }
  }
  const features = {};
  for (const [name, F] of [...feats.entries()].sort()) features[name] = [...F.values()].map((a) => ({ step: a.step, status: a.status, n: a.n, inRuns: a.runs, expectedAnswer: a.expected, message: a.message, stateAfterwards: a.state, ms: { median: pct(a.p50s, 50), p95: a.p95s.length ? Math.max(...a.p95s) : null, max: a.max || null }, call: a.method && a.method !== "-" ? `${a.method} ${a.path}` : "" }));
  const top = Object.entries(cnt.unexpectedTop).sort((x, y) => y[1] - x[1]).slice(0, 40); cnt.unexpectedTop = Object.fromEntries(top);
  writeJson(join(O.out, `feature-table-${game}.json`), { game, site: G.site, builtAt: new Date().toISOString(), siteCommits: [...commits], featuresNotInThisGame: absent, features });
  writeJson(join(O.out, `counts-${game}.json`), { ...cnt, builtAt: new Date().toISOString(), siteCommits: [...commits], note: "ms 'median' = median of per-run medians; 'p95' = highest per-run p95" });
  return cnt;
}
const cnt = merge();
say(`${game}: ${cnt.runs} runs on file (${cnt.journeys} journeys, ${cnt.games} games); outcomes ${JSON.stringify(cnt.outcomes)}; calls ${cnt.calls}; joined ${cnt.joined}; unexpected answers ${cnt.unexpectedTotal}; 5xx ${cnt.s5xx}; 429 ${cnt.s429}; network errors ${cnt.netErrors}`);
say(`tables: ${join(O.out, `feature-table-${game}.json`)} , ${join(O.out, `counts-${game}.json`)}`);
await sleep(10);
process.exit(stopped ? 4 : 0);
