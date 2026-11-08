// Corporate Lucky Draw. People join; at the draw time (automatic) or when the organizer presses Draw (manual) winners are picked. /draw (public), /drawset (organizer), /drawnow (organizer).
export default {
  name: "luckydraw", signedPause: true, claims: null, endAfterNumbers: 20, totalNumbers: 90,
  absent: { claims: "Lucky Draw has no pattern claims: winners are picked by the draw (apps/edge draw.ts); the generic /claims route is only probed" },
  createExtra: () => ({}),
  async afterSetup(ctx, S) {
    const b = await ctx.call("lucky-draw", "draw-facts-before", "GET", `/api/z/${S.eid}/draw`, { as: null, expect: [200, 404] });
    ctx.setState(`mode=${b.j?.mode} winners=${b.j?.winners} drawn=${b.j?.drawn}`);
    await ctx.call("lucky-draw", "draw-settings-too-many-winners", "POST", `/api/z/${S.eid}/drawset`, { body: { winners: S.cap + 5, mode: "auto" }, expect: [400], tries: 0 });
    const ok = await ctx.call("lucky-draw", "draw-settings-save", "POST", `/api/z/${S.eid}/drawset`, { body: { winners: 3, prizes: ["SMOKE10M prize 1", "SMOKE10M prize 2", "SMOKE10M prize 3"], mode: "manual" }, expect: [200] });
    ctx.setState(`winners=${ok.j?.winners} mode=${ok.j?.mode}`);
    S.drawManual = ok.ok;
  },
  async extra(ctx, S) {
    const pre = await ctx.call("lucky-draw", "draw-facts-at-start", "GET", `/api/z/${S.eid}/draw`, { as: null, expect: [200, 404] });
    ctx.setState(`drawn=${pre.j?.drawn} closed=${pre.j?.closed ?? pre.j?.registrationClosed}`);
    await ctx.call("lucky-draw", "player-cannot-draw", "POST", `/api/z/${S.eid}/drawnow`, { as: null, body: {}, expect: [401, 403], tries: 0 });
    const d = await ctx.call("lucky-draw", "draw-now-manual", "POST", `/api/z/${S.eid}/drawnow`, { body: {}, expect: [200, 409, 400] });
    ctx.setState(`ok=${!!d.j?.ok} already=${!!d.j?.already} err=${(d.j?.error || "").slice(0, 60)}`);
    const d2 = await ctx.call("lucky-draw", "draw-now-twice", "POST", `/api/z/${S.eid}/drawnow`, { body: {}, expect: [200, 409] });
    ctx.setState(`already=${!!d2.j?.already}`);
    const post = await ctx.call("lucky-draw", "draw-result-public", "GET", `/api/z/${S.eid}/draw`, { as: null, expect: [200] });
    ctx.setState(`drawn=${post.j?.drawn} winners=${(post.j?.winners || post.j?.result || []).length}`);
    const p = S.players.filter(Boolean)[0];
    if (p) { const me = await ctx.call("lucky-draw", "my-result", "GET", `/api/z/${S.eid}/draw?pid=${encodeURIComponent(p.pid)}`, { as: null, expect: [200] }); ctx.setState(`won=${me.j?.won ?? me.j?.youWon ?? "?"}`); }
    await ctx.call("lucky-draw", "settings-after-draw-refused", "POST", `/api/z/${S.eid}/drawset`, { body: { winners: 1, mode: "auto" }, expect: [409, 200] });
    await ctx.call("lucky-draw", "game-log", "GET", `/api/z/${S.eid}/gamelog`, { expect: [200, 404] });
  },
};
