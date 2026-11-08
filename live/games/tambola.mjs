// Corporate Tambola (housie.corporatetambola.com). Numbers are called by the phones from the public beacon; the server keeps claims, votes, check-in and the signed pause file.
// Full set of features. Optional REAL phone code (--runtime N): N of the people use the site's own zgame.js (PhoneRuntime) over the network, as the t250 test did.
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { HERE, nameOf } from "../lib.mjs";

export default {
  name: "tambola", signedPause: true, claims: { valid: "early5", wrongPattern: "nonsense", maxIdx: 89, bogey: true }, endAfterNumbers: 20, totalNumbers: 90,
  absent: {},
  createExtra: () => ({}),
  /** before the start: real phone code for N of the people (only when asked and when node can load the site's zgame.js) */
  async preStart(ctx, S) {
    if (!S.runtime || ctx.dry) return;
    try {
      const dir = join(HERE, "vendor", "assets-cache", "tambola"); mkdirSync(dir, { recursive: true });
      for (const f of ["zgame.js", "control.js"]) { const r = await fetch(ctx.site + "/" + f, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(f + " " + r.status); writeFileSync(join(dir, f), await r.text()); }
      copyFileSync(join(HERE, "vendor", "assets", "consent-text.json"), join(dir, "consent-text.json"));
      process.env.LIVE_ASSETS = dir;
      const M = await import("../vendor/nodephone.mjs");
      S.rt = { M, H: new M.Harness(ctx.site, { ipPool: 1 }), phones: [] };
      const pick = S.players.filter(Boolean).slice(30, 30 + S.runtime);
      // these people are ALREADY joined through the API (same device ids); the real phone code opens the same ticket again and plays it
      for (const p of pick) {
        const ph = new M.NodePhone(S.rt.H, S.eid, { phone: p.phone, name: nameOf(S.game, p.i), rid: "R" + p.i }, { claim: "always", light: S.rt.phones.length >= Math.max(1, Math.ceil(S.runtime / 5)) });
        ph.store.set("ctz:device", p.device);
        try { await ph.open(); const ok = await ph.join(); ph.ok = ok; if (ok) ph.go(); } catch (e) { ph.err = String(e).slice(0, 100); }
        S.rt.phones.push(ph);
      }
      ctx.note("runtime-phones", "started", `${S.rt.phones.filter((x) => x.ok).length}/${pick.length} real-phone-code players joined and playing (zgame.js from the live site)`);
    } catch (e) { ctx.note("runtime-phones", "not-started", String(e).slice(0, 160)); S.rt = null; }
  },
  async finish(ctx, S) {
    if (!S.rt) return;
    const ph = S.rt.phones.filter((x) => x.ok); let ended = 0, minN = 1e9, maxN = 0, wins = 0, errs = 0;
    for (const p of ph) {
      try { const v = p.rt.view(); const n = v.log.filter((x) => x > 0).length; minN = Math.min(minN, n); maxN = Math.max(maxN, n); if (p.rt.phase === "ended") ended++; wins += v.results.filter((r) => (r.pids || []).includes(v.pid)).length; errs += p.errors.length; } catch { errs++; }
      p.stop();
    }
    ctx.note("runtime-phones", "result", `real-phone-code players ${ph.length}: ended ${ended}, numbers min/max ${ph.length ? minN : 0}/${maxN}, prizes won ${wins}, phone errors ${errs}`, `calls=${S.rt.H.calls} failed=${S.rt.H.fails}`);
  },
};
