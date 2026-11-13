// 13 Nov 2026: the machine-wide set-up gate. Falsify: gapS 0 (gate off) -> the spacing test fails.
import { describe, expect, test } from "bun:test";
import { makeSetupGate } from "./setup-gate.mjs";
const clock = () => { let t = 1_000_000; return { now: () => t, sleep: async (ms) => { t += ms; }, adv: (ms) => { t += ms; } }; };
describe("setup gate", () => {
  test("twelve workers asking in the same second get slots at least ~16 s apart (20 s gap, -20 % jitter at worst)", async () => {
    const c = clock(); const g = makeSetupGate({ gapS: 20, now: c.now, sleep: c.sleep, rand: () => 0 });
    const starts = []; for (let i = 0; i < 12; i++) { await g.slot(); starts.push(c.now()); }
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(16_000);
    expect(starts[11] - starts[0]).toBeGreaterThanOrEqual(11 * 16_000);
  });
  test("never more than one set-up in any 10-second window on a machine (D1's window), whatever the jitter", async () => {
    for (const r of [0, 0.5, 0.999]) {
      const c = clock(); const g = makeSetupGate({ gapS: 20, now: c.now, sleep: c.sleep, rand: () => r });
      const starts = []; for (let i = 0; i < 30; i++) { await g.slot(); starts.push(c.now()); }
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThan(10_000);
    }
  });
  test("a busy / 503 answer holds every new start for 60 s; an ordinary answer does not", async () => {
    const c = clock(); const g = makeSetupGate({ gapS: 20, now: c.now, sleep: c.sleep, rand: () => 0.5 });
    await g.slot(); c.adv(25_000); // an ordinary start, the slot is free again
    expect(g.sawAnswer("join: 5 of 20 seats")).toBe(false); const t0 = c.now(); const waited = await g.slot(); expect(waited).toBe(0); expect(c.now()).toBe(t0);
    c.adv(25_000); expect(g.sawAnswer("sign-in 503 [site busy] The doors are very busy")).toBe(true); const t1 = c.now(); const w2 = await g.slot();
    expect(w2).toBeGreaterThanOrEqual(60_000); expect(c.now() - t1).toBeGreaterThanOrEqual(60_000);
  });
  test("gate off (no gap): no waiting at all, like before", async () => {
    const c = clock(); const g = makeSetupGate({ gapS: 0, now: c.now, sleep: c.sleep }); for (let i = 0; i < 5; i++) expect(await g.slot()).toBe(0); expect(c.now()).toBe(1_000_000);
  });
});
