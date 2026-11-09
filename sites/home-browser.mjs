// TARGET-9999 HOME track, browser step: real Microsoft Edge (headless) on the partner laptop, not this laptop.
// Checks, per page, at 375 px (mobile) and 1366 px (desktop):
//   - HTTP 200, no console errors, no page errors, no failed requests to home.corporatetambola.com
//   - no horizontal page scroll (document scrollWidth <= viewport width)
//   - the create-game CTA is present and its href reaches the console host
// Usage (on the partner, in C:\dev\home-t9999): node home-browser.mjs [--ledger file] [--count]
import { chromium } from "playwright-core";
import { appendFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const HOST = "https://home.corporatetambola.com";
const CONSOLE = "console.corporatetambola.com";
const LEDGER = argOf("--ledger", "home-browser-ledger.jsonl");
const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812, mobile: true },
  { name: "desktop-1366", width: 1366, height: 800, mobile: false },
];
const MARKER_UA = "Mozilla/5.0 T9999-RUN";

async function sitemapPages() {
  const x = await (await fetch(`${HOST}/sitemap.xml`)).text();
  return [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

const browser = await chromium.launch({ channel: process.env.T99_CHROME_CHANNEL || "msedge", headless: true });
const problems = [];
let theme = null;
let envCspTotal = 0;
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, userAgent: MARKER_UA + " " + vp.name });
    // Record every CSP violation with the start of the blocked inline script, so the environmental rule can read it.
    await ctx.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__cspViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI, sample: e.sample || "" }));
    });
    const page = await ctx.newPage();
    for (const url of await sitemapPages()) {
      const consoleErr = [];
      const pageErr = [];
      const badReq = [];
      page.removeAllListeners("console"); page.removeAllListeners("pageerror"); page.removeAllListeners("requestfailed");
      page.on("console", (m) => { if (m.type() === "error") consoleErr.push(m.text().slice(0, 160)); });
      page.on("pageerror", (e) => pageErr.push(String(e.message).slice(0, 160)));
      page.on("requestfailed", (r) => { if (r.url().startsWith(HOST)) badReq.push(r.url()); });
      const resp = await page.goto(url, { waitUntil: "load", timeout: 30000 });
      if (!resp || resp.status() !== 200) problems.push(`${vp.name} ${url}: status ${resp && resp.status()}`);
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      if (sw[0] > sw[1] + 1) problems.push(`${vp.name} ${url}: horizontal scroll ${sw[0]} > ${sw[1]}`);
      const cta = await page.$$eval(`a[href*="${CONSOLE}"]`, (els) => els.map((e) => e.href));
      if (url.endsWith("/") && !cta.length) problems.push(`${vp.name} ${url}: no create-game CTA`);
      // Environmental rule (BOSS, 5 Nov): ONLY the CSP refusal of the inline bot-detection script (source mentions __CF$cv$params
      // or the cdn-cgi/challenge-platform path) is noise, counted in env_csp. Every other console or page error fails the run.
      const viol = await page.evaluate(() => window.__cspViolations || []).catch(() => []);
      // The CSP event does not expose the blocked script text, so count the page's own inline scripts that carry the Cloudflare markers,
      // and treat at most that many inline refusals as environmental.
      const html = await page.content();
      const cfInline = (html.match(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/g) || []).filter((x) => /__CF\$cv\$params|cdn-cgi\/challenge-platform/.test(x)).length;
      const allInlineViol = viol.filter((v) => v.blocked === "inline").length;
      const envCsp = Math.min(cfInline, allInlineViol);
      envCspTotal += envCsp;
      // Only drop inline-refusal console lines when EVERY inline violation on the page is the bot-detection one (the console text does not name the script).
      const dropInline = envCsp > 0 && envCsp === allInlineViol;
      const nonEnvConsole = consoleErr.filter((t) => !(dropInline && /Refused to execute inline script/.test(t)));
      if (nonEnvConsole.length) problems.push(`${vp.name} ${url}: console errors ${nonEnvConsole.length} e.g. ${nonEnvConsole[0]}`);
      if (pageErr.length) problems.push(`${vp.name} ${url}: page errors ${pageErr[0]}`);
      if (badReq.length) problems.push(`${vp.name} ${url}: failed requests ${badReq[0]}`);
      if (!theme) {
        const m = (await page.content()).match(/theme\.js\?v=([0-9a-f]{6,})/);
        theme = m ? m[1] : null;
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

const rec = { game: "home-browser", commit: theme || "unknown", kind: problems.length ? "fail" : "clean", at: new Date().toISOString(), problems: problems.slice(0, 10), env_csp: envCspTotal, env_csp_rule: "inline script CSP refusal whose source mentions __CF$cv$params or cdn-cgi/challenge-platform; counted separately, never fails" };
const line = JSON.stringify(rec);
if (args.has("--count")) appendFileSync(LEDGER, line + "\n");
console.log(line);
