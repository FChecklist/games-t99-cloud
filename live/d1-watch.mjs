// In-job D1 overload watcher (9 Nov 2026, BOSS order). Runs inside each cloud job next to the sampler, polls each sampled game's OWN D1 from the GitHub runner every 60 s
// (independent of the owner's laptop network) and, when it sees a new "overloaded" error, writes live/t99/PAUSE-<game>, which the sampler already honours: NO NEW game of that
// type starts on this machine until the pause ends; games already in flight finish normally. Harness only: it reads, never writes to D1, changes no game and no counted result.
// The read-only D1 token comes from the job environment (CLOUDFLARE_D1_TOKEN / CLOUDFLARE_ACCOUNT_ID) and is never printed; nothing from the HTTP request or the token reaches the log.
//   bun live/d1-watch.mjs --games snakes[,luck...] [--every 60] [--pause-min 180] [--machine cloud1] [--out live/t99/d1-watch-cloud1.log]
// Test hook: D1_WATCH_API_BASE replaces https://api.cloudflare.com/client/v4 (a fake server in the test).
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const D1 = { tambola: "4a6a1d3f-f1c7-44ac-b0ce-4cebd749a8de", bingo: "f2d1ed1b-77cd-401a-af4c-4c02724688ef", tictactoe: "6f1d9846-7716-4209-8cad-85ed83dc8f1f", snakes: "3ed0dc2c-c3ab-489c-9e99-71c3644ff30a", luck: "c98bedfe-6de2-40bc-bcd8-ba79f0ef68c6", luckydraw: "aa913d0a-24e2-4bd2-a9bd-27e7186a24bd" };
const a = process.argv.slice(2); const opt = (k, d) => { const i = a.indexOf("--" + k); return i < 0 ? d : a[i + 1]; };
const games = String(opt("games", "")).split(",").map((s) => s.trim()).filter((g) => D1[g]);
const everyS = Number(opt("every", 60)), pauseMin = Number(opt("pause-min", 180)), machine = String(opt("machine", "cloud"));
const out = String(opt("out", join(HERE, "t99", `d1-watch-${machine}.log`)));
const T = join(HERE, "t99"); mkdirSync(T, { recursive: true }); mkdirSync(dirname(out), { recursive: true });
const BASE = process.env.D1_WATCH_API_BASE || "https://api.cloudflare.com/client/v4";
const TOKEN = process.env.CLOUDFLARE_D1_TOKEN || "", ACCT = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const log = (...x) => { const line = new Date().toISOString().slice(11, 19) + " " + x.join(" "); try { appendFileSync(out, line + "\n"); } catch {} console.log(line); };
if (!games.length) { log("d1-watch: no known game in --games, nothing to watch"); process.exit(0); }
if (!TOKEN || !ACCT) { log("d1-watch: D1 read secrets are not in the environment, NOT watching (the laptop watcher is the only layer for this run)"); process.exit(0); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const since = Date.now(); // only errors after this watcher started count: stale errors of an earlier run must not pause a fresh one
/** Count of 'overloaded' errors in the game's D1 since `since`, or null when the read failed. The HTTP detail is never logged. */
async function overloads(game) {
  try {
    const r = await fetch(`${BASE}/accounts/${ACCT}/d1/database/${D1[game]}/query`, { method: "POST", headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" }, body: JSON.stringify({ sql: `select count(*) c from error_report where ts>=${since} and body like '%overloaded%'` }), signal: AbortSignal.timeout(25000) });
    if (!r.ok) return { err: "http " + r.status };
    const j = await r.json(); const c = j?.result?.[0]?.results?.[0]?.c;
    return typeof c === "number" ? { c } : { err: "unreadable reply" };
  } catch (e) { return { err: String(e?.name || "error") }; }
}
log(`d1-watch started: ${games.join(",")} every ${everyS}s on ${machine}; pause when overloaded = ${pauseMin} min of no new games (games in flight finish)`);
const blind = {}, paused = {};
for (;;) {
  for (const g of games) {
    const r = await overloads(g);
    if (r.err) { blind[g] = (blind[g] || 0) + 1; if (blind[g] === 1 || blind[g] % 10 === 0) log(`${g}: D1 read failed (${r.err}), blind x${blind[g]}`); continue; }
    if (blind[g]) { log(`${g}: D1 read works again after ${blind[g]} failed tries`); blind[g] = 0; }
    if (r.c > 0) {
      writeFileSync(join(T, `PAUSE-${g}`), String(Date.now() + pauseMin * 60000));
      if (!paused[g]) { log(`${g}: OVERLOAD errors ${r.c} in this game's D1 -> PAUSE-${g} written, no new ${g} game starts on ${machine} for ${pauseMin} min`); paused[g] = true; }
    }
  }
  await sleep(everyS * 1000);
}
