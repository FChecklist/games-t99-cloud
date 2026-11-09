// TARGET-9999 claim 8 (console.corporatetambola.com): one public-journey trial per run, on the partner laptop (real Microsoft Edge, headless, 375 px and 1366 px).
// Scope (honest): the console is a noindex single-page shell that signs organizers in. This robot covers what any visitor reaches WITHOUT signing in:
//   FETCH half  : GET /, /version.json, /manifest.webmanifest, every same-origin stylesheet/script/icon the shell references (all 200), the games-bar links to the game sites (all 200).
//   BROWSER half: the shell renders at 375 px and 1366 px with text on screen, no console error, no page error, no failed request to the console host, no horizontal scroll.
// Signed-in console flows (create game, publish, team, payments) are exercised by the per-game runs (claims 2 to 6), not here.
// Environmental rule (same as HOME, BOSS 5 Nov): ONLY the CSP refusal of the inline Cloudflare bot-detection script (__CF$cv$params / cdn-cgi/challenge-platform) is counted in env_csp and never fails.
// Usage (partner, C:\dev\home-t9999): node console-t99.mjs [--count] [--prefix console]    writes console-fetch.jsonl and console-browser.jsonl when --count
import { chromium } from "playwright-core";
import { appendFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const PREFIX = argOf("--prefix", "console");
const HOST = "https://console.corporatetambola.com";
const UA = process.env.T99_FETCH_UA || "TARGET99-console-check/1.0 (Corporate Games reliability test; GitHub Actions; read-only GET)"; // cloud copy: honest, non-browser UA (BOSS 9 Nov)
const at = new Date().toISOString();

async function get(url) {
  for (let a = 1; a <= 2; a++) {
    try { const r = await fetch(url, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) }); return { status: r.status, text: await r.text(), type: r.headers.get("content-type") || "" }; }
    catch (e) { const m = String(e?.cause?.code || e?.message || e); if (a === 2 || !/ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/.test(m)) return { status: 0, text: "", type: "", error: m }; await new Promise((r) => setTimeout(r, 3000)); }
  }
}

// ---------- FETCH half ----------
const bad = [];
const root = await get(HOST + "/");
let commit = "unknown";
if (root.status !== 200 || root.text.length < 1000 || !/<title>[^<]{2,}<\/title>/i.test(root.text)) bad.push(`/ status ${root.status} len ${root.text.length}`);
const ver = await get(HOST + "/version.json");
try { const v = JSON.parse(ver.text); if (v.commit) commit = String(v.commit).slice(0, 12); else bad.push("version.json has no commit"); } catch { bad.push(`version.json not JSON (status ${ver.status})`); }
const man = await get(HOST + "/manifest.webmanifest");
try { const m = JSON.parse(man.text); if (!m.name && !m.short_name) bad.push("manifest has no name"); } catch { bad.push(`manifest not JSON (status ${man.status})`); }
const refs = new Set();
for (const m of root.text.matchAll(/(?:href|src)="([^"#]+)"/g)) { const u = m[1]; if (/^https?:\/\//.test(u) ? u.startsWith(HOST) : u.startsWith("/")) refs.add(u.startsWith("/") ? HOST + u : u); }
const ext = new Set();
for (const m of root.text.matchAll(/href="(https:\/\/[a-z0-9-]+\.corporatetambola\.com[^"#]*)"/g)) ext.add(m[1]);
for (const u of [...refs].filter((x) => !/\/api\//.test(x)).slice(0, 40)) { const r = await get(u); if (r.status !== 200) bad.push(`asset ${u.replace(HOST, "")} -> ${r.status}${r.error ? " " + r.error : ""}`); }
for (const u of [...ext].slice(0, 12)) { const r = await get(u); if (r.status !== 200) bad.push(`link ${u} -> ${r.status}${r.error ? " " + r.error : ""}`); }
const fetchRec = { game: "console-fetch", commit, kind: bad.length ? "fail" : "partial", at, problems: bad.slice(0, 10), assets: refs.size, links: ext.size };

// ---------- BROWSER half ----------
const problems = [];
let envCsp = 0;
const VIEWPORTS = [{ name: "mobile-375", width: 375, height: 812, mobile: true }, { name: "desktop-1366", width: 1366, height: 800, mobile: false }];
const browser = await chromium.launch({ channel: process.env.T99_CHROME_CHANNEL || "msedge", headless: true });
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, userAgent: "Mozilla/5.0 T9999-RUN " + vp.name });
    await ctx.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.blockedURI)); });
    const page = await ctx.newPage();
    const consoleErr = [], pageErr = [], badReq = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErr.push(m.text().slice(0, 160)); });
    page.on("pageerror", (e) => pageErr.push(String(e.message).slice(0, 160)));
    page.on("requestfailed", (r) => { if (r.url().startsWith(HOST)) badReq.push(r.url()); });
    const resp = await page.goto(HOST + "/", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1500);
    if (!resp || resp.status() !== 200) problems.push(`${vp.name}: status ${resp && resp.status()}`);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, (document.body.innerText || "").trim().length]);
    if (sw[0] > sw[1] + 1) problems.push(`${vp.name}: horizontal scroll ${sw[0]} > ${sw[1]}`);
    if (sw[2] < 20) problems.push(`${vp.name}: blank page (${sw[2]} chars of text)`);
    const viol = await page.evaluate(() => window.__csp || []).catch(() => []);
    const html = await page.content();
    const cfInline = (html.match(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/g) || []).filter((x) => /__CF\$cv\$params|cdn-cgi\/challenge-platform/.test(x)).length;
    const inl = viol.filter((v) => v === "inline").length, env = Math.min(cfInline, inl);
    envCsp += env;
    const dropInline = env > 0 && env === inl;
    const real = consoleErr.filter((t) => !(dropInline && /Refused to execute inline script|Executing inline script violates/.test(t)));
    if (real.length) problems.push(`${vp.name}: console errors ${real.length} e.g. ${real[0]}`);
    if (pageErr.length) problems.push(`${vp.name}: page errors ${pageErr[0]}`);
    if (badReq.length) problems.push(`${vp.name}: failed requests ${badReq[0]}`);
    await ctx.close();
  }
} finally { await browser.close(); }
const browserRec = { game: "console-browser", commit, kind: problems.length ? "fail" : "clean", at: new Date().toISOString(), problems: problems.slice(0, 10), env_csp: envCsp };

if (args.has("--count")) {
  appendFileSync(`${PREFIX}-fetch.jsonl`, JSON.stringify(fetchRec) + "\n");
  appendFileSync(`${PREFIX}-browser.jsonl`, JSON.stringify(browserRec) + "\n");
}
console.log(JSON.stringify({ fetch: fetchRec.kind, browser: browserRec.kind, commit, fetchProblems: bad.slice(0, 3), browserProblems: problems.slice(0, 3), assets: refs.size, links: ext.size }));
