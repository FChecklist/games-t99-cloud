// Corporate Tic Tac Toe: a knockout tournament. Organizer: /ttt/start (solo/team, moveSecs), then the organizer's PAGE computes the bracket and posts /ttt/plan; players play /ttt/open,/move,/result.
// This driver does start / setup / view / pause / resume / end and best-effort player probes. The bracket engine (packages/ttt) is not run here, so the plan is never posted: declared below.
import { sleep } from "../lib.mjs";
export default {
  name: "tictactoe", signedPause: false, claims: null, endAfterNumbers: 20, totalNumbers: 90,
  absent: {
    claims: "Tic Tac Toe has no claims: matches are played board by board; the generic /claims route is only probed",
    "pause-resume (signed)": "Tic Tac Toe pauses with its own routes /ttt/pause and /ttt/resume (apps/edge tournament.ts), not with the signed control messages; tested through those routes",
    "bracket-and-moves": "the bracket is computed by the organizer's page and phones (packages/ttt); this driver does not run it, so no match is played (declared, not a site fault)",
  },
  createExtra: () => ({}),
  pause: async (ctx, S) => {
    const T = (p) => `/api/z/${S.eid}/ttt/${p}`;
    const p = await ctx.call("pause-resume", "ttt-pause", "POST", T("pause"), { body: {}, expect: [200, 409, 403] });
    ctx.setState(`paused=${p.j?.paused}`);
    await sleep(8000);
    await ctx.call("pause-resume", "ttt-pause-again", "POST", T("pause"), { body: {}, expect: [200, 409] });
    const r = await ctx.call("pause-resume", "ttt-resume", "POST", T("resume"), { body: {}, expect: [200, 409, 403] });
    ctx.setState(`paused=${r.j?.paused}`);
    await ctx.call("pause-resume", "ttt-player-cannot-pause", "POST", T("pause"), { as: null, body: {}, expect: [401, 403], tries: 0 });
  },
  async extra(ctx, S) {
    const T = (p) => `/api/z/${S.eid}/ttt/${p}`;
    const v = await ctx.call("ttt-tournament", "view-public", "GET", T("view"), { as: null, expect: [200] });
    ctx.setState(`state=${v.j?.state} joined=${v.j?.joined}`);
    await ctx.call("ttt-tournament", "setup-before-start", "GET", T("setup"), { as: null, expect: [200] });
    await ctx.call("ttt-tournament", "reveal-before-start", "GET", T("reveal"), { as: null, expect: [200] });
    await ctx.call("ttt-tournament", "player-cannot-start", "POST", T("start"), { as: null, body: { format: "solo", moveSecs: 20 }, expect: [401, 403], tries: 0 });
    await ctx.call("ttt-tournament", "start-bad-move-clock", "POST", T("start"), { body: { format: "solo", moveSecs: 7 }, expect: [400], tries: 0 });
    const s = await ctx.call("ttt-tournament", "organizer-start-solo", "POST", T("start"), { body: { format: "solo", moveSecs: 20 }, expect: [200, 409] });
    ctx.setState(`players=${s.j?.players} state=${s.j?.state} code=${s.j?.code || "-"}`);
    await ctx.call("ttt-tournament", "organizer-start-twice", "POST", T("start"), { body: { format: "solo", moveSecs: 20 }, expect: [409, 200] });
    await ctx.call("ttt-tournament", "setup-after-start", "GET", T("setup"), { expect: [200] });
    const p = S.players.filter(Boolean)[0];
    if (p) {
      const m = await ctx.call("ttt-tournament", "move-probe-before-plan", "POST", T("move"), { as: null, body: { pid: p.pid, device: p.device, mid: "r1m0", seq: 0, sq: 4 }, expect: [400, 409, 403, 404] });
      ctx.setState(`probe answer: ${(m.j?.error || "").slice(0, 70)}`);
      await ctx.call("ttt-tournament", "move-from-other-phone", "POST", T("move"), { as: null, body: { pid: p.pid, device: "f".repeat(32), mid: "r1m0", seq: 0, sq: 4 }, expect: [403] });
    }
    await ctx.call("ttt-tournament", "rank-public", "GET", T("rank"), { as: null, expect: [200] });
    await ctx.call("ttt-tournament", "stuck-list", "GET", T("stuck"), { expect: [200, 403] });
    await ctx.call("ttt-tournament", "all-matches", "GET", T("all"), { expect: [200, 403] });
  },
  async finish(ctx, S) {
    const e = await ctx.call("ttt-tournament", "organizer-end", "POST", `/api/z/${S.eid}/ttt/end`, { body: {}, expect: [200, 409] });
    ctx.setState(`ok=${!!e.j?.ok} code=${e.j?.code || "-"}`);
  },
};
