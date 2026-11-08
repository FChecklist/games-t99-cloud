// Corporate Bingo. Same engine as Tambola with a 75-ball card (claim index 0..74), a houses list, a comic-reactions switch (rxmode) and a game log.
import { consentBody, nameOf } from "../lib.mjs";
// Live Bingo is in ID-only mode (4 Nov): an ID that is NOT on the organizer's list waits for approval (and after a few tries is locked out). So the organizer first lists everybody with their employee ID, as a real organizer would.
const empOf = (S, i) => "E" + String(S.runId).replace(/[^A-Za-z0-9]/g, "").slice(-8) + i;
export default {
  async afterSetup(ctx, S) {
    let added = 0, bad = 0;
    for (let from = 1; from <= S.P; from += 25) {
      const people = []; for (let i = from; i < from + 25 && i <= S.P; i++) people.push({ name: nameOf(S.game, i), empId: empOf(S, i) });
      const r = await ctx.call("people-list", "list-everybody-with-ids", "POST", `/api/z/${S.eid}/people`, { body: { people, consent: consentBody(ctx, "K6") }, expect: [200] });
      added += r.j?.added ?? 0; bad += (r.j?.invalid || []).length;
    }
    ctx.note("people-list", "listed-with-ids", `${added} of ${S.P} listed with their employee ID; ${bad} refused`, `added=${added}`);
  },
  name: "bingo", signedPause: true, claims: { valid: "blackout", wrongPattern: "nonsense", maxIdx: 74, bogey: false }, endAfterNumbers: 20, totalNumbers: 75,
  absent: { "false-claim-bogey": "no /bogey route in the Bingo worker (checked in apps/edge/src/worker.ts at the live commit 4d636fa)" },
  createExtra: () => ({}),
  async extra(ctx, S) {
    for (const m of ["reduced", "full", "off", "wild"]) await ctx.call("bingo-reactions", "reactions-" + m, "POST", `/api/z/${S.eid}/rxmode`, { body: { mode: m }, expect: m === "wild" ? [400] : [200], tries: 0 });
    const g = await ctx.call("game-log", "game-log", "GET", `/api/z/${S.eid}/gamelog`, { expect: [200, 404] });
    ctx.setState(`rows=${Array.isArray(g.j?.log) ? g.j.log.length : g.j ? Object.keys(g.j).length : 0}`);
  },
};
