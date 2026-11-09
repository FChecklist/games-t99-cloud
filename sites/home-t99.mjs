// TARGET-99 track 7 (HOME): one real-site journey per run against home.corporatetambola.com.
// Fetch + DOM checks only. Headless-browser checks (375 px / desktop rendering, console errors) are NOT in this file yet and are reported as not covered.
// Usage: node home-t99.mjs [--once] [--dry] [--ledger <file>] [--count]
//   --dry    run the checks, print results, write nothing to the ledger
//   --count  write ledger lines that count toward the 299 (BOSS starts counting only after home-landing's commit)
//   --once   one run and exit (default: loop every 20-40 min with jitter, until HOME-STOP file appears)
import { writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const HOST = "https://home.corporatetambola.com";
const CONSOLE_HOST = "console.corporatetambola.com";
const here = dirname(fileURLToPath(import.meta.url));
const LEDGER = argOf("--ledger", join(here, "home-ledger.jsonl"));
const STOP = join(here, "HOME-STOP");
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 TARGET99-home-check";

async function get(url, opts = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(url, { redirect: "follow", headers: { "user-agent": UA_DESKTOP, ...(opts.headers || {}) }, method: opts.method || "GET", body: opts.body, signal: AbortSignal.timeout(20000) });
      const text = opts.noBody ? "" : await r.text();
      return { status: r.status, text, url: r.url };
    } catch (e) {
      const msg = String(e?.cause?.code || e?.message || e);
      if (attempt === 2 || !/ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/.test(msg)) return { status: 0, text: "", error: msg };
      await new Promise((res) => setTimeout(res, 3000));
    }
  }
}

function nowIso() { return new Date().toISOString(); }

export async function runOnce() {
  const checks = [];
  const fail = (name, why) => checks.push({ name, ok: false, why });
  const pass = (name, why = "ok") => checks.push({ name, ok: true, why });

  // 1. robots and sitemap
  const robots = await get(`${HOST}/robots.txt`);
  if (robots.status === 200 && /Sitemap:/i.test(robots.text)) pass("robots"); else fail("robots", `status ${robots.status}${robots.error ? " " + robots.error : ""}`);
  const sm = await get(`${HOST}/sitemap.xml`);
  const pages = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (sm.status === 200 && pages.length >= 17) pass("sitemap", `${pages.length} urls`); else fail("sitemap", `status ${sm.status}, ${pages.length} urls`);

  // 2. every page: 200, real content, tracker tag present, DOM markers
  let version = null;
  const linkSet = new Set();
  let consoleCta = false;
  for (const url of pages) {
    const r = await get(url);
    if (r.status !== 200) { fail(`page ${url}`, `status ${r.status}${r.error ? " " + r.error : ""}`); continue; }
    if (!/<title>[^<]{3,}<\/title>/i.test(r.text)) fail(`page ${url}`, "no title");
    else if (!/<h1[\s>]/i.test(r.text)) fail(`page ${url}`, "no h1");
    else if (r.text.length < 2000) fail(`page ${url}`, `too short ${r.text.length}`);
    else if (!/a\.js\?v=/.test(r.text)) fail(`page ${url}`, "tracker tag missing");
    else pass(`page ${url}`);
    const v = r.text.match(/theme\.js\?v=([0-9a-f]{6,})/);
    if (v && !version) version = v[1];
    for (const m of r.text.matchAll(/href="([^"#]+)"/g)) {
      const h = m[1];
      if (/^(mailto|tel|javascript):/i.test(h)) continue;
      if (h.includes(CONSOLE_HOST)) consoleCta = true;
      if (h.startsWith("/cdn-cgi/")) continue; // Cloudflare-injected email-protection links, not site content
      if (h.startsWith("/") && !h.startsWith("//")) linkSet.add(HOST + h);
      else if (h.startsWith(HOST)) linkSet.add(h);
    }
  }

  // 3. every internal link and CTA resolves (2xx after redirects)
  let badLinks = 0;
  for (const link of linkSet) {
    const r = await get(link, { noBody: true });
    if (r.status >= 200 && r.status < 400) continue;
    badLinks++;
    fail(`link ${link}`, `status ${r.status}${r.error ? " " + r.error : ""}`);
  }
  if (!badLinks) pass("internal links", `${linkSet.size} unique`);

  // 4. create-game CTA reaches the console
  if (!consoleCta) fail("console CTA", "no link to console host on any page");
  else {
    const c = await get(`https://${CONSOLE_HOST}/`, { noBody: true });
    if (c.status >= 200 && c.status < 400) pass("console CTA", `status ${c.status}`); else fail("console CTA", `status ${c.status}${c.error ? " " + c.error : ""}`);
  }

  // 5. click tracking: one event, shaped exactly as the page's tracker sends it (home-landing, 5 Nov).
  // Only with --click, and only after home-landing confirms the T9999-RUN marker is live (before that the marker counts as a human visit).
  if (args.has("--click")) {
    const sid = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const did = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const body = JSON.stringify({ s: sid, g: 0, dv: "desktop", l: "en", d: did, lp: "/team-building-games", r: "", u: { s: "", m: "", c: "" }, e: [{ k: "pv", p: "/team-building-games" }, { k: "act", p: "/team-building-games", n: "t9999-probe", v: "" }] });
    const t = await get(`${HOST}/api/t`, { method: "POST", headers: { "content-type": "text/plain", "user-agent": "Mozilla/5.0 T9999-RUN/1.0" }, body, noBody: true });
    if (t.status === 204) pass("click tracking", "204"); else fail("click tracking", `status ${t.status}${t.error ? " " + t.error : ""}`);
  } else {
    checks.push({ name: "click tracking", ok: true, why: "not covered (run without --click until home-landing confirms the marker is live)", uncovered: true });
  }

  const env = checks.some((c) => !c.ok && /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|status 0/.test(c.why));
  const failed = checks.filter((c) => !c.ok);
  // "partial" = every fetch check passed but the browser steps (click tracking, viewports, console errors) are not run yet, so it is NOT clean and does not count toward 299.
  const kind = failed.length ? (env && failed.every((c) => /status 0|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/.test(c.why)) ? "env" : "fail") : "partial";
  return { game: "home", commit: version || "unknown", kind, at: nowIso(), checks: checks.length, failed: failed.slice(0, 8).map((c) => `${c.name}: ${c.why}`), viewports: "not covered (needs headless browser)", console_errors: "not covered (needs headless browser)" };
}

async function main() {
  do {
    const rec = await runOnce();
    const line = JSON.stringify(rec);
    if (args.has("--dry")) console.log(line);
    else {
      if (args.has("--count")) appendFileSync(LEDGER, line + "\n");
      else appendFileSync(LEDGER.replace(/\.jsonl$/, "-uncounted.jsonl"), line + "\n");
      console.log(line);
    }
    if (args.has("--once")) break;
    const wait = (20 + Math.random() * 20) * 60 * 1000;
    await new Promise((res) => setTimeout(res, wait));
  } while (!existsSync(STOP));
}

if (import.meta.main) main();
