// Cloud loop for the home / console robots (9 Nov 2026). Runs the SAME three robots as the partner laptop (home-t99.mjs, home-browser.mjs, console-t99.mjs),
// unchanged except that the browser channel comes from T99_CHROME_CHANNEL ("chrome" = the Google Chrome preinstalled on GitHub's ubuntu runners).
// Read-only: GET requests and a headless browser only; no sign-in, no payment, no sign-up. One trial per site every --wait seconds (default 180).
// Ledgers are written in the format the pool engine already reads: <prefix>-fetch.jsonl and <prefix>-browser.jsonl, one pair of rows per trial, in order.
// Guards: --stop-after-fail 3 consecutive real failures end the loop early (a person looks), and the graceful stop file sites/out/STOP ends it at the hour limit.
//   bun sites/loop.mjs --kind home|console --prefix home3 --hours 2 --wait 180
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url)), OUT = join(HERE, "out"); mkdirSync(OUT, { recursive: true });
const a = process.argv.slice(2); const opt = (k, d) => { const i = a.indexOf("--" + k); return i < 0 ? d : a[i + 1]; };
const kind = String(opt("kind", "home")), prefix = String(opt("prefix", kind + "3")), hours = Number(opt("hours", 2)), waitS = Number(opt("wait", 180)), stopAfter = Number(opt("stop-after-fail", 3));
const LOG = join(OUT, `${prefix}-loop.log`);
const say = (...x) => { const l = new Date().toISOString().slice(11, 19) + " " + x.join(" "); console.log(l); try { appendFileSync(LOG, l + "\n"); } catch {} };
const end = Date.now() + hours * 3600000 - 25 * 60000; // no new trial in the last 25 minutes (same graceful end as the game lanes)
const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: HERE, encoding: "utf8", timeout: 600000, env: { ...process.env, T99_CHROME_CHANNEL: process.env.T99_CHROME_CHANNEL || "chrome" } }); return ((r.stdout || "") + (r.stderr || "")).trim().split("\n").slice(-1)[0] || `exit ${r.status}`; };
const lastKinds = (file, n) => { try { return readFileSync(file, "utf8").trim().split("\n").slice(-n).map((l) => JSON.parse(l).kind); } catch { return []; } };
say(`loop start kind=${kind} prefix=${prefix} hours=${hours} wait=${waitS}s`);
let consecutiveFail = 0, trials = 0;
while (Date.now() < end && !existsSync(join(OUT, "STOP"))) {
  const t0 = Date.now();
  if (kind === "home") {
    const f = run(["home-t99.mjs", "--once", "--click", "--count", "--ledger", join(OUT, `${prefix}-fetch.jsonl`)]);
    const b = run(["home-browser.mjs", "--count", "--ledger", join(OUT, `${prefix}-browser.jsonl`)]);
    say("fetch", f.slice(0, 140)); say("browser", b.slice(0, 140));
  } else {
    const c = run(["console-t99.mjs", "--count", "--prefix", join(OUT, prefix)]);
    say("console", c.slice(0, 200));
  }
  trials++;
  const k = [...lastKinds(join(OUT, `${prefix}-fetch.jsonl`), 1), ...lastKinds(join(OUT, `${prefix}-browser.jsonl`), 1)];
  const bad = k.some((x) => x === "fail"); consecutiveFail = bad ? consecutiveFail + 1 : 0;
  if (consecutiveFail >= stopAfter) { say(`STOP: ${consecutiveFail} real failures in a row, a person must look (ledger kept)`); break; }
  await new Promise((r) => setTimeout(r, Math.max(5000, waitS * 1000 - (Date.now() - t0)) + Math.random() * 20000));
}
say(`loop end after ${trials} trials`);
