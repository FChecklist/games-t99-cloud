// Corporate Snakes and Ladders ("presence" play: everybody presses the dice button inside the same window of each turn). Routes: /throw (a player), /throws (public list), /override (organizer prize call), /prizes, /prizegiven.
import { sleep } from "../lib.mjs";
export default {
  name: "snakes", signedPause: true, claims: null, endAfterNumbers: 20, totalNumbers: 60,
  absent: {
    claims: "Snakes and Ladders has no pattern claims: the winner is decided by the board; the generic /claims route is only probed",
    "board-engine": "board positions are computed on the phones from the throws; this driver sends the throw presses only (declared, not a site fault)",
  },
  createExtra: () => ({ play: "presence" }),
  async extra(ctx, S) {
    const T = (p) => `/api/z/${S.eid}/${p}`; const cs = S.callSeconds * 1000;
    const crowd = S.players.filter(Boolean).slice(0, 40);
    if (!crowd.length) return;
    const one = crowd[0];
    await ctx.call("snakes-throws", "throw-from-other-phone", "POST", T("throw"), { as: null, body: { pid: one.pid, device: "f".repeat(32), turn: 0 }, expect: [403] });
    await ctx.call("snakes-throws", "throw-bad-turn", "POST", T("throw"), { as: null, body: { pid: one.pid, device: one.device, turn: -1 }, expect: [400] });
    // turns 0..3: the sample presses at the moment each turn opens (the exact window is the site's: 409 not-open / late-move are recorded as they come)
    for (let turn = 0; turn < 4; turn++) {
      const at = S.startMs + turn * cs + 1500; const d = at - Date.now(); if (d > 0) await sleep(Math.min(d, 60000));
      let ok = 0, other = 0;
      await Promise.all(crowd.map(async (p) => { const r = await ctx.call("snakes-throws", "throw-turn-" + turn, "POST", T("throw"), { as: null, body: { pid: p.pid, device: p.device, turn }, expect: [200, 409], tries: 0 }); if (r.ok) ok++; else other++; }));
      ctx.setState(`turn ${turn}: ${ok} accepted, ${other} refused (window rule)`);
    }
    await ctx.call("snakes-throws", "throw-turn-0-late", "POST", T("throw"), { as: null, body: { pid: one.pid, device: one.device, turn: 0 }, expect: [409] });
    const l = await ctx.call("snakes-throws", "list-throws", "GET", T("throws?from=0&to=10"), { as: null, expect: [200] });
    ctx.setState(`throws=${(l.j?.throws || []).length}`);
    const o = await ctx.call("snakes-prizes", "organizer-override-probe", "POST", T("override"), { body: { seat: one.seat, prize: "x" }, expect: [200, 400, 404, 409] });
    ctx.setState(`probe answer: ${(o.j?.error || "ok").slice(0, 60)}`);
    await ctx.call("snakes-prizes", "override-by-player", "POST", T("override"), { as: null, body: { seat: 1 }, expect: [401, 403], tries: 0 });
  },
};
