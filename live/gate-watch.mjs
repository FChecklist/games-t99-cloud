// Runs on the BOSS laptop ONLY (the Cloudflare token lives in C:\ct\ct\.env.local and is read by the python gate scripts, never by this file, never printed).
// Runs the six gate scripts, counts rows whose id starts SMK10M- as "ours" and everything else as "others" (real customers), writes gate-status.json.
//   node live/gate-watch.mjs [--once] [--every 300] [--hours 3] [--out live/gate-status.json] [--push]   (--push also runs gate-push.sh after each write)
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GAMES, HERE, sleep } from "./lib.mjs";
const a = process.argv.slice(2); const opt = (k, d) => { const i = a.indexOf("--" + k); return i < 0 ? d : (a[i + 1] === undefined || a[i + 1].startsWith("--") ? true : a[i + 1]); };
const hours = String(opt("hours", 3)), every = Number(opt("every", 300)), out = String(opt("out", join(HERE, "gate-status.json"))), once = !!opt("once", false), push = !!opt("push", false);
const T = join(HERE, "..", "tools") + "/";
function one(game) {
  const d1 = GAMES[game].d1;
  try {
    const txt = d1 ? execFileSync("python3", [T + "live_games_now_game.py", d1, hours], { encoding: "utf8", timeout: 90000 }) : execFileSync("python3", [T + "live_games_now.py", hours], { encoding: "utf8", timeout: 90000 });
    const m = /\(not cancelled\):\s*(\d+)/.exec(txt); if (!m) return { error: "unreadable gate output: " + txt.slice(0, 120).replace(/\s+/g, " ") };
    const rows = txt.split(/\r?\n/).filter((l) => /^\s+\S+\s+cap\s/.test(l)).map((l) => l.trim());
    const ours = rows.filter((r) => r.startsWith("SMK10M-")).length;
    const otherRows = rows.filter((r) => !r.startsWith("SMK10M-"));
    if (Number(m[1]) !== rows.length) return { error: `gate said ${m[1]} games but ${rows.length} rows were read` };
    return { total: rows.length, ours, others: otherRows.length, otherRows };
  } catch (e) { return { error: String(e.message || e).split("\n")[0].slice(0, 160) }; }
}
for (;;) {
  const games = {}; for (const g of Object.keys(GAMES)) games[g] = one(g);
  const j = { at: new Date().toISOString(), hours: Number(hours), games };
  writeFileSync(out, JSON.stringify(j, null, 1));
  console.log(j.at.slice(11, 19), Object.entries(games).map(([g, v]) => `${g}:${v.error ? "ERR" : v.others + " real/" + v.ours + " ours"}`).join("  "));
  if (push) try { execFileSync("bash", [join(HERE, "gate-push.sh")], { stdio: "inherit", timeout: 120000 }); } catch { console.log("push failed (retry next round)"); }
  if (once) break; await sleep(every * 1000);
}
