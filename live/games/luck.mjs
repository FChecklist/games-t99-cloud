// Corporate Luck by Chance: dice rounds computed on the phones from a sealed seed; the server freezes the seat list at start, hands out beacon values when due, collects result votes.
// Routes /api/z/{id}/luck/{view,seats,me,beacon,start,end,press,presses,vote,rank,reveal,tick}. Phone-side scoring and the result vote are NOT simulated here (needs the game package): declared below.
import { sleep } from "../lib.mjs";
export default {
  name: "luck", signedPause: true, claims: null, endAfterNumbers: 20, totalNumbers: 90,
  absent: {
    claims: "Luck by Chance has no pattern claims: it ends with the phones' result vote; the generic /claims route is only probed",
    "result-vote": "the phones compute scores with packages/luck and vote a result; this driver does not run that engine, so 'result agreed' stays false (declared, not a site fault)",
  },
  createExtra: () => ({}),
  async extra(ctx, S) {
    const L = (p) => `/api/z/${S.eid}/luck/${p}`;
    const v = await ctx.call("luck-game", "view-public", "GET", L("view"), { as: null, expect: [200] });
    ctx.setState(`state=${v.j?.state} joined=${v.j?.joined} players=${v.j?.players}`);
    const p = S.players.filter(Boolean)[0];
    if (p) { const m = await ctx.call("luck-game", "me-before-start", "GET", L(`me?pid=${encodeURIComponent(p.pid)}&device=${p.device}`), { as: null, expect: [200] }); ctx.setState(`phase=${m.j?.phase}`); }
    await ctx.call("luck-game", "seats-before-start", "GET", L("seats"), { as: null, expect: [409] });
    await ctx.call("luck-game", "beacon-before-start", "GET", L("beacon?from=0"), { as: null, expect: [409] });
    await ctx.call("luck-game", "player-cannot-start", "POST", L("start"), { as: null, body: {}, expect: [401, 403], tries: 0 });
    const st = await ctx.call("luck-game", "organizer-start", "POST", L("start"), { body: { settings: {} }, expect: [200, 400, 409] });
    ctx.setState(`ok=${!!st.j?.ok} pending=${!!st.j?.pending} err=${(st.j?.error || "").slice(0, 70)}`);
    await ctx.call("luck-game", "organizer-start-twice", "POST", L("start"), { body: { settings: {} }, expect: [200, 409] });
    await sleep(6000);
    await ctx.call("luck-game", "seats-after-start", "GET", L("seats"), { as: null, expect: [200, 409] });
    const bc = await ctx.call("luck-game", "beacon-values-due", "GET", L("beacon?from=0"), { as: null, expect: [200, 409] });
    ctx.setState(`values=${(bc.j?.values || []).length} total=${bc.j?.total}`);
    if (p) {
      for (const g of [0, 1]) { const r = await ctx.call("luck-game", "press-round-" + g, "POST", L("press"), { as: null, body: { pid: p.pid, device: p.device, g }, expect: [200, 409] }); ctx.setState(`code=${r.j?.code || "ok"} ignored=${!!r.j?.ignored}`); }
      await ctx.call("luck-game", "press-from-other-phone", "POST", L("press"), { as: null, body: { pid: p.pid, device: "f".repeat(32), g: 0 }, expect: [403] });
      await ctx.call("luck-game", "vote-before-end", "POST", L("vote"), { as: null, body: { pid: p.pid, device: p.device, result: { overall: [], rounds: [] } }, expect: [409, 400] });
    }
    await ctx.call("luck-game", "rank-public", "GET", L("rank"), { as: null, expect: [200] });
    await ctx.call("luck-game", "reveal-before-end", "GET", L("reveal"), { as: null, expect: [200] });
  },
  async finish(ctx, S) {
    const e = await ctx.call("luck-game", "organizer-end-game", "POST", `/api/z/${S.eid}/luck/end`, { body: {}, expect: [200, 409] });
    ctx.setState(`ok=${!!e.j?.ok} code=${e.j?.code || "-"}`);
  },
};
