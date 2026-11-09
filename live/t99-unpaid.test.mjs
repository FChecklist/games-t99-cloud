// BOSS 9 Nov 2026, option B: classification of the demo2/demo3 "402 payment-due on the public view" artefact. Harness only.
import { describe, expect, test } from "bun:test";
import { classify } from "./t99.mjs";
const V = "luck-game/view-public GET /api/z/:eid/luck/view -> 402 [payment-due] This game is waiting for the organizer's payment.";
const mk = (o = {}) => ({ outcome: "ended", ended: true, joined: 20, unexpected: [V, V, "late-join/x GET /y -> 404"], stats: { calls: 185 }, ...o });
describe("402 payment-due on the public view", () => {
  test("demo2 / demo3 game, ended normally, only that answer -> env-unpaid", () => {
    for (const e of ["demo2@xyz.in", "demo3@xyz.in"]) expect(classify(mk(), 20, e).kind).toBe("env-unpaid");
  });
  test("a demo1 game, or an organizer we do not know, with that answer stays a failure", () => {
    expect(classify(mk(), 20, "demo1@xyz.in").kind).toBe("fail");
    expect(classify(mk(), 20, "").kind).toBe("fail");
  });
  test("any other odd answer alongside it stays a failure", () => {
    expect(classify(mk({ unexpected: [V, "luck-game/organizer-start POST /a -> 403 Not yours"] }), 20, "demo2@xyz.in").kind).toBe("fail");
  });
  test("a game that did not end normally or lost players stays a failure", () => {
    expect(classify(mk({ joined: 19 }), 20, "demo2@xyz.in").kind).toBe("fail");
    expect(classify(mk({ ended: false }), 20, "demo2@xyz.in").kind).not.toBe("env-unpaid");
    expect(classify(mk({ outcome: "ran-not-confirmed-ended" }), 20, "demo2@xyz.in").kind).not.toBe("env-unpaid");
  });
  test("a server error answer stays a failure", () => {
    expect(classify(mk({ unexpected: [V, "x GET /y -> 503 Something went wrong"] }), 20, "demo3@xyz.in").kind).toBe("fail");
  });
});
