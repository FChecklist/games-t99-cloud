import { execFileSync } from "node:child_process";
// TARGET-99 unattended runner (one per machine: partner laptop, phone). Run with bun:
//   bun live/t99.mjs --machine partner --workers 3 --share 0.67      (phone: --machine phone --workers 1 --share 0.33)
// Plan: TARGET-99-REAL-GAME-REAL-WEBSITE-PLAN.md. 6 game types, 299 failure-free runs each on ONE frozen version, sizes 20/100/250 = 20/40/40 %.
// Each run = ONE full real game through run.mjs (sign-in, create, publish, players join, play to the end, reports, erase). One ledger line per run.
// Pass rules (strict, fixed in advance):
//   CLEAN  : outcome "ended" AND ended=true AND joined >= 95 % of the players AND every "unexpected answer" is on the list of NORMAL refusals (late-join closed, waiting-room/family/people-list
//            answers the scenario provokes on purpose, ...). Any 5xx / [server-error] / "Something went wrong" / wrong outcome = FAIL.
//   FAIL   : a real site problem -> the type is HALTED (file t99/HALT-<game>) for classification by a person; nothing for that type starts until the file is deleted.
//   ENV    : our side, not the site (NETWORK errors, "Not allowed" from a dead organizer key, "up to 5 Hosts" left over, per-address join guard "busy"). Not counted as clean, not counted as a site failure, the run is repeated;
//            5 ENV in a row for one type = that type pauses 30 minutes. "busy" marks the site's day budget as used up until 00:00 UTC (05:30 IST).
// Stops: file live/STOP or t99/STOP (all), t99/HALT-<game> (one type). A type stops by itself at its 299 (this machine's share of them).
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv[i + 1]; };
const MACHINE = String(opt("machine", "partner"));
const WORKERS = Number(opt("workers", 1));
const SHARE = Number(opt("share", 0.5));
const TOTAL = Number(opt("total", 299)); // legacy, only used by the old plan print
const DRY = argv.includes("--dry-plan");
// ---- STRATIFIED SAMPLING (owner order 8 Nov 2026, TARGET-9999-SAMPLING-PLAN-2026-11-08.md) ----
// Trial unit = one player-session (joined player on a clean run). A CELL = game x player count (20/100/250) x time-of-day band (IST) x client (phone/desktop).
// Target per cell = max(FLOOR, TARGET x risk weight of the size / (bands x clients)); a cell that has a site failure on the live commit is sampled to 3x.
// The picker always starts the cell with the largest relative deficit among the cells of the CURRENT time band, so every band and client gets its floor.
const TARGET = Number(opt("target", 92099));
const ONLY = String(opt("only", "")).split(",").map((x) => x.trim()).filter(Boolean);
const REJOIN_N = Number(opt("rejoin-n", 10)); // rejoin trials per run (cheap extra trials of the first-join vs rejoin stratum)
const W = { 20: 0.1, 100: 0.3, 250: 0.6 }; // risk weights of the player-count strata (sum 1)
const FLOOR = Math.ceil(0.02 * TARGET); // minimum sessions in EVERY cell
const BANDS = ["night", "day", "evening"];
const CLIENTS = ["desktop", "mobile"];
const bandOf = (d = new Date()) => { const h = ((d.getUTCHours() * 60 + d.getUTCMinutes() + 330) / 60) % 24; return h < 8 ? "night" : h < 18 ? "day" : "evening"; }; // IST bands: night 00-08, day 08-18, evening 18-24
const cellTarget = (size, failed) => Math.max(FLOOR, Math.ceil((TARGET * W[size]) / (BANDS.length * CLIENTS.length))) * (failed ? 3 : 1);
const T = join(HERE, "t99"); mkdirSync(T, { recursive: true });
const LEDGER = join(T, `ledger-${MACHINE}.jsonl`);
// Phone runs the five non-Tambola games only (BOSS 6 Nov): pick() gives every Tambola candidate a fixed bonus, so Tambola always won on the phone.
const ALLTYPES = MACHINE === "phone" ? ["bingo", "tictactoe", "snakes", "luck", "luckydraw"] : ["tambola", "bingo", "tictactoe", "snakes", "luck", "luckydraw"];
const TYPES = ONLY.length ? ALLTYPES.filter((g) => ONLY.includes(g)) : ALLTYPES;
const SIZES = [20, 100, 250];
const MIX = { 20: 0.2, 100: 0.4, 250: 0.4 };
// seats one address may open per site per day (measured: Tambola about 3000, 3x the pack; the others assumed 1500 until a day shows otherwise) split between the two machines
// since 5 Nov the join guard is skipped for SMK10M- test games that carry the runner key, so the seat budget is effectively unlimited; a "busy" answer still marks the site day-full
const DAY_SEATS = { tambola: 1e7, bingo: 1e7, tictactoe: 1e7, snakes: 1e7, luck: 1e7, luckydraw: 1e7 };
const EXTRA_SEATS = 35; // late joiners, family members, probes: every run asks for a few more seats than its crowd
const MAX_PER_SITE = Number(opt("per-site", 2));
// run ids must never repeat (run.mjs skips an id that already has a run file): machine offset + seconds since 5 Nov 2026 00:00 UTC, one id per start
const ID_BASE = ({ partner: 1, phone: 2, cloud1: 3, cloud2: 4, cloud3: 5, cloud4: 6, cloud5: 7, cloud6: 8, cloud7: 9, cloud8: 10 }[MACHINE] ?? 11) * 100000000;
const idNow = () => ID_BASE + Math.floor((Date.now() - Date.UTC(2026, 10, 5)) / 1000) * 10;
let lastId = 0;
const nextId = () => { lastId = Math.max(lastId + 1, idNow()); return lastId; };

const say = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); try { appendFileSync(join(T, `t99-${MACHINE}.log`), l + "\n"); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

function readLedger() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function quotas(share) {
  const q = Math.round(TOTAL * share), q20 = Math.round(q * MIX[20]), q100 = Math.round(q * MIX[100]);
  return { 20: q20, 100: q100, 250: q - q20 - q100 };
}
const Q = quotas(SHARE);

// ---------- classification of one finished run ----------
const NORMAL = /^(late-join|join-edge|families|people-list|waiting-room|leave-rejoin|cohost\/cohost-list-before-accepting-role|pause-resume\/request-pause|create\/create-game|snakes-throws\/throw-turn-\d+-late|announce|fairness|probe)/;
const SERIOUS = /\b5\d\d\b|server-error|Something went wrong|crash|exception/i;
export function classify(j, players) {
  if (!j) return { kind: "env", why: "no run file written" };
  const un = (j.unexpected || []).map(String);
  const signinRefused = un.filter((x) => /^signin\/test-login .*-> 400/.test(x.trim())); // the game is in LIVE mode: the test sign-in is (rightly) refused
  // a DNS blip on the very first request (GET /version.json, before our resolver cache is warm) is our side and does not touch the game itself: ignored when the commit was still captured (the same call is repeated and recorded as ok later)
  const net = un.filter((x) => /NETWORK:/.test(x) && !(/^version\/version\.json /.test(x.trim()) && (j.commit || j.version?.commit)));
  const busy = un.filter((x) => /site busy|It is busy right now|very busy/i.test(x));
  const notAllowed = un.filter((x) => /Not allowed/.test(x));
  const hostLeft = un.filter((x) => /up to \d+ Hosts/.test(x));
  if (signinRefused.length && j.outcome !== "ended") return { kind: "env-signin", why: "test sign-in refused (this game is in LIVE mode, TEST mode is needed for these runs)" };
  const serious = un.filter((x) => SERIOUS.test(x) && !/NETWORK:/.test(x));
  const wrongOk = un.filter((x) => /-> 200 ok/.test(x) && !/throw-turn-\d+-late/.test(x)); // something that should have been refused was accepted
  const odd = un.filter((x) => !NORMAL.test(x.trim()) && !/NETWORK:|site busy|It is busy|very busy|Not allowed|up to \d+ Hosts/.test(x) && !SERIOUS.test(x));
  const need = Math.ceil(0.95 * players);
  if (serious.length) return { kind: "fail", why: `server error answers (${serious.length}): ${serious[0].slice(0, 160)}` };
  if (wrongOk.length) return { kind: "fail", why: `accepted what should be refused: ${wrongOk[0].slice(0, 160)}` };
  if (busy.length) return { kind: "env-busy", why: `per-address join guard answered busy ${busy.length}x` };
  if (j.outcome !== "ended" && (net.length || notAllowed.length || hostLeft.length)) return { kind: net.length ? "env" : "env", why: `outcome ${j.outcome} with our-side problems (net ${net.length}, not-allowed ${notAllowed.length}, hosts ${hostLeft.length})` };
  if (j.outcome !== "ended") return { kind: "fail", why: `outcome ${j.outcome}${j.error ? " " + String(j.error).slice(0, 120) : ""}` };
  if (!j.ended) return { kind: notAllowed.length || net.length ? "env" : "fail", why: "end not confirmed" + (notAllowed.length ? " (organizer key died: Not allowed)" : net.length ? " (network)" : "") };
  if ((j.joined ?? 0) < need) return { kind: net.length ? "env" : "fail", why: `only ${j.joined} of ${players} joined` };
  if (odd.length) return { kind: "fail", why: `unexpected answer not on the normal list: ${odd[0].slice(0, 160)}` };
  // RULE for ignoring network blips (boss, 5 Nov): only client-side DNS failures (getaddrinfo ENOTFOUND / EAI_AGAIN), never an HTTP 4xx/5xx, a timeout, a reset or a refused connection from the site; the retry must have succeeded and the game must
  // still have ended with >=95% of the crowd and no other odd answer; the blip count is written in the ledger line (netBlips) and must stay at or below 5% of the run's requests. Otherwise the run is ENV (repeated), never clean.
  const calls = j.stats?.calls ?? 0, netN = j.stats?.netErrors ?? net.length;
  const dnsOnly = net.length > 0 && net.every((x) => /getaddrinfo (ENOTFOUND|EAI_AGAIN)/.test(x));
  if (net.length && dnsOnly && netN <= 0.05 * calls && !notAllowed.length && !hostLeft.length) return { kind: "clean", blips: netN, why: `net blips ignored: ${netN} DNS failures in ${calls} requests (our resolver, retried)` };
  if (net.length || notAllowed.length || hostLeft.length) return { kind: "env", why: `game ended but our side had problems (net ${net.length}, not-allowed ${notAllowed.length}, hosts ${hostLeft.length}); not counted as clean` };
  return { kind: "clean", why: "" };
}

// ---------- state ----------
// Counts are per LIVE commit (BOSS, 5 Nov): a game's clean runs count toward its quota only when they ran on the commit the site serves now.
// The live commit comes from each site's version.json (cached 60 s). If a site cannot be read, that game counts nothing (safe: more runs, never fewer).
const SITE_HOST = { tambola: "https://housie.corporatetambola.com", bingo: "https://bingo.corporatetambola.com", tictactoe: "https://tictactoe.corporatetambola.com", snakes: "https://snakes.corporatetambola.com", luck: "https://luck.corporatetambola.com", luckydraw: "https://luckydraw.corporatetambola.com" };
const liveCache = { at: 0, map: {} };
function liveCommits() {
  if (Date.now() - liveCache.at < 60000) return liveCache.map;
  const map = {};
  for (const g of TYPES) {
    // A few tries, 3 s apart (BOSS 7 Nov): a failed read is never guessed; if all tries fail the game counts nothing this minute.
    for (let attempt = 1; attempt <= 3 && !map[g]; attempt++) {
      try {
        const out = execFileSync("curl", ["-s", "--max-time", "8", `${SITE_HOST[g]}/version.json`], { encoding: "utf8" });
        const c = JSON.parse(out).commit;
        if (typeof c === "string" && /^[0-9a-f]{7,40}$/.test(c)) map[g] = c;
      } catch {}
      if (!map[g] && attempt < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    }
  }
  liveCache.at = Date.now(); liveCache.map = map;
  return map;
}
function cellKey(g, size, band, ua) { return `${g}|${size}|${band}|${ua}`; }
function state() {
  const L = readLedger(), today = utcDay(), live = liveCommits();
  const cell = {}, failedCell = {}, seats = {}, envRun = {};
  for (const g of TYPES) { seats[g] = 0; envRun[g] = 0; }
  for (const r of L) {
    const cur = live[r.game];
    const onLive = cur && String(r.commit || "").startsWith(cur);
    const band = r.band || bandOf(new Date(Date.parse(r.at) - 1000 * (r.secs || 0))), ua = r.ua || "desktop"; // old rows: desktop client, band from their start time
    const k = cellKey(r.game, r.size, band, ua);
    if (r.kind === "clean" && onLive) cell[k] = (cell[k] || 0) + (r.joined || r.size);
    if (r.kind === "fail" && onLive) failedCell[k] = true;
    if (String(r.at).slice(0, 10) === today) seats[r.game] = (seats[r.game] || 0) + r.size + EXTRA_SEATS;
  }
  for (const g of TYPES) { const last = L.filter((r) => r.game === g).slice(-5); envRun[g] = last.length === 5 && last.every((r) => String(r.kind).startsWith("env")) ? 1 : 0; }
  return { L, cell, failedCell, seats, envRun, today };
}
const inFlight = {}; // game -> count; and reserved seats
const reserved = {};
function halted(g) { return existsSync(join(T, `HALT-${g}`)); }
function stopped() { return existsSync(join(T, "STOP")) || existsSync(join(HERE, "STOP")) || existsSync("C:/dev/ON_BATTERY.flag"); }
function dayFull(g, today) { return existsSync(join(T, `DAYFULL-${g}-${today}`)); }
function pausedUntil(g) { try { return Number(readFileSync(join(T, `PAUSE-${g}`), "utf8")) || 0; } catch { return 0; } }

// Importance allocation + sequential stopping (owner order 8 Nov): pool_engine.py writes t99/alloc.json per game: size_priority (where the pooled posterior is widest: game-level modules -> many small games,
// player-level modules -> big games) and stop=true the moment the lower 99.99% credible bound of that game's claim reaches 99.99%.
const allocCache = { at: 0, v: {} };
function ALLOC() { if (Date.now() - allocCache.at > 60000) { allocCache.at = Date.now(); try { allocCache.v = JSON.parse(readFileSync(join(T, "alloc.json"), "utf8")); } catch { allocCache.v = {}; } } return allocCache.v; }
function pick() {
  const S = state(), band = bandOf();
  const cands = [];
  const lastAt = {};
  for (const r of S.L) if (r.machine === MACHINE && r.game) lastAt[r.game] = Date.parse(r.at) || 0;
  for (const g of TYPES) {
    if (halted(g) || dayFull(g, S.today) || (inFlight[g] || 0) >= MAX_PER_SITE || Date.now() < pausedUntil(g)) continue;
    const budget = DAY_SEATS[g] * SHARE;
    for (const size of SIZES) for (const ua of CLIENTS) {
      const k = cellKey(g, size, band, ua), tgt = cellTarget(size, S.failedCell[k]);
      const have = (S.cell[k] || 0) + (inFlight[k] || 0) * size;
      if (have >= tgt) continue;
      if (S.seats[g] + (reserved[g] || 0) + size + EXTRA_SEATS > budget) continue;
      const al = ALLOC()[g];
      if (al && al.stop) continue; // claim reached its bound: stop sampling this game (sequential stopping)
      let score = (tgt - have) / tgt + 0.01 * Math.min(1, (Date.now() - (lastAt[g] || 0)) / 3600000);
      if (al && al.size_priority) score *= 3 * (al.size_priority[String(size)] ?? 0.33);
      cands.push({ g, size, ua, band, k, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands[0] || null;
}
function allDone() {
  const S = state();
  return TYPES.every((g) => SIZES.every((z) => BANDS.every((b) => CLIENTS.every((u) => { const k = cellKey(g, z, b, u); return (S.cell[k] || 0) >= cellTarget(z, S.failedCell[k]); }))));
}

function spawnRun(game, size, id, ua) {
  return new Promise((resolve) => {
    const out = join(HERE, "out", "t99", game); mkdirSync(out, { recursive: true });
    const args = [join(HERE, "run.mjs"), game, "--organizers", "0", "--games", "1", "--players", String(size), "--from", String(id), "--parallel", "1", "--out", out, "--join-cap-day", "40000", "--write-cap", "600000"];
    const p = spawn(process.execPath, args, { cwd: dirname(HERE), env: { ...process.env, LIVE_PUBLIC_DNS: "1", T99_UA: ua || "desktop", T99_REJOIN_N: String(REJOIN_N) }, stdio: ["ignore", "pipe", "pipe"] });
    let tail = ""; p.stdout.on("data", (d) => { tail = (tail + d).slice(-600); }); p.stderr.on("data", (d) => { tail = (tail + d).slice(-600); });
    p.on("exit", (code) => resolve({ code, out, tail }));
    p.on("error", (e) => resolve({ code: -1, out, tail: String(e) }));
  });
}

async function worker(n) {
    while (true) {
    if (stopped()) { say(`worker ${n}: STOP file, exiting`); return; }
    const c = pick();
    if (!c) {
      if (allDone()) { say(`worker ${n}: all cells at target`); return; }
      await sleep(60000); continue;
    }
    const { g, size, ua, band, k: ck } = c;
    const id = nextId();
    inFlight[g] = (inFlight[g] || 0) + 1; inFlight[ck] = (inFlight[ck] || 0) + 1; reserved[g] = (reserved[g] || 0) + size + EXTRA_SEATS;
    const t0 = Date.now();
    say(`start ${g} ${size} players ${ua} ${band} id ${id}`);
    const r = await spawnRun(g, size, id, ua);
    inFlight[g]--; inFlight[ck]--; reserved[g] -= size + EXTRA_SEATS;
    // Gate refused (BOSS, 5 Nov): skip THIS game for 5 minutes so the worker can run other games; never block the whole runner on one game.
    if (r.code === 3) { writeFileSync(join(T, `PAUSE-${g}`), String(Date.now() + 300000)); say(`${g}: gate refused (a real game is running or gate file stale): skipped for 5 minutes, other games continue`); await sleep(30000); continue; }
    if (r.code === 4) { say("run.mjs saw a STOP file"); return; }
    let j = null; const file = join(r.out, "runs", `run-${g}-game-${String(id).padStart(3, "0")}.json`);
    try { j = JSON.parse(readFileSync(file, "utf8")); if (new Date(j.startedAt).getTime() < t0 - 5000) j = null; } catch {}
    const v = classify(j, size);
    const rejoins = (j?.rows || []).filter((x) => /come-back-same-phone/.test(String(x.step)) && x.expected !== false).reduce((a, x) => a + (x.n || 1), 0);
    const line = { at: new Date().toISOString(), machine: MACHINE, game: g, size, ua, band, rejoins, id, kind: v.kind, why: v.why, outcome: j?.outcome ?? "no-file", joined: j?.joined ?? 0, ended: !!j?.ended, secs: Math.round((Date.now() - t0) / 1000), version: j?.version?.version ?? j?.commit ?? "?", commit: j?.version?.commit ?? j?.commit ?? "?", unexpected: (j?.unexpected || []).length, netBlips: v.blips ?? 0, requests: j?.stats?.calls ?? 0, exit: r.code };
    appendFileSync(LEDGER, JSON.stringify(line) + "\n");
    say(`${g} ${size} id ${id}: ${v.kind.toUpperCase()} ${v.why} (${line.joined} joined, ${line.secs}s)`);
    if (v.kind === "fail") { writeFileSync(join(T, `HALT-${g}`), `${line.at} ${MACHINE} ${g} ${size} id ${id}: ${v.why}\nDelete this file only after the failure is classified (defect = fix + release + restart the count; test fault = fix the runner).\n`); say(`HALT ${g}`); }
    if (v.kind === "env-signin") { writeFileSync(join(T, `PAUSE-${g}`), String(Date.now() + 6 * 3600000)); say(`${g}: test sign-in refused: paused 6 hours (needs TEST mode: boss decision)`); }
    if (v.kind === "env-busy") { writeFileSync(join(T, `DAYFULL-${g}-${utcDay()}`), line.at); say(`${g}: join guard says busy: no more ${g} seats today (until 00:00 UTC)`); }
    if (S2(g)) { writeFileSync(join(T, `PAUSE-${g}`), String(Date.now() + 30 * 60000)); say(`${g}: 5 our-side problems in a row: paused 30 minutes`); }
    await sleep(3000);
  }
}
function S2(g) { return state().envRun[g] === 1; }

// ---------- plan ----------
function plan() {
  console.log(`machine ${MACHINE}: stratified, target ${TARGET} sessions per game, floor ${FLOOR} per cell, cells = ${SIZES.length} sizes x ${BANDS.length} bands x ${CLIENTS.length} clients, games ${TYPES.join(",")}`);
  for (const z of SIZES) console.log(`size ${z}: target per cell ${cellTarget(z, false)} sessions (${Math.ceil(cellTarget(z, false) / z)} runs per cell), 3x on a failed cell = ${cellTarget(z, true)}`);
}
if (import.meta.main) {
  if (DRY) { plan(); process.exit(0); }
  plan();
  say(`t99 start machine ${MACHINE} workers ${WORKERS} share ${SHARE} only=${ONLY.join(",") || "all"} target=${TARGET}`);
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));
  say("t99 end");
}
