// BOSS 9 Nov 2026 23:40 IST: eid collision fix (harness only). A collision is simulated: the site answers {existed:true} for an id that an older game already owns.
import { describe, expect, test } from "bun:test";
import { newEid, EID_SPACE } from "./lib.mjs";
import { createFresh } from "./common.mjs";
import { eidFields } from "./t99.mjs";
describe("newEid", () => {
  test("12 characters, SMK10M- prefix, 5 base36 chars, space 36^5", () => {
    for (let i = 0; i < 500; i++) expect(newEid()).toMatch(/^SMK10M-[0-9a-z]{5}$/);
    expect(EID_SPACE).toBe(60466176);
  });
  test("uniform over the alphabet (rejection sampling): bytes >= 252 are never used", () => {
    const ids = new Set(); for (let i = 0; i < 3000; i++) ids.add(newEid()); expect(ids.size).toBeGreaterThan(2990);
    expect(newEid(() => Uint8Array.from([252, 253, 254, 255, 0, 1, 2, 3]))).toBe("SMK10M-01230");
  });
});
describe("createFresh (collision simulated)", () => {
  const owned = new Set(["SMK10M-aaaaa"]); // an older, started game
  const fake = (S) => async (b) => ({ ok: true, j: owned.has(b.id) ? { existed: true } : { draft: true } });
  test("an id the site already has -> a fresh id is used, the journey continues on it, existed is recorded", async () => {
    const S = { eid: "SMK10M-aaaaa" }; const base = { id: S.eid };
    const c = await createFresh(fake(S), S, base);
    expect(c.j.existed).toBeUndefined(); expect(S.existed).toBe(true); expect(S.eidRetries).toBe(1);
    expect(S.eid).not.toBe("SMK10M-aaaaa"); expect(base.id).toBe(S.eid); expect(owned.has(S.eid)).toBe(false);
  });
  test("a free id -> no retry, existed stays unset", async () => {
    const S = { eid: "SMK10M-bbbbb" }; const base = { id: S.eid };
    await createFresh(fake(S), S, base); expect(S.existed).toBeUndefined(); expect(S.eidRetries).toBeUndefined(); expect(S.eid).toBe("SMK10M-bbbbb");
  });
  test("always existed -> stops after 4 retries and still reports existed", async () => {
    const S = { eid: "x" }; const base = { id: "x" }; let n = 0;
    const c = await createFresh(async () => { n++; return { ok: true, j: { existed: true } }; }, S, base);
    expect(n).toBe(5); expect(S.eidRetries).toBe(4); expect(S.existed).toBe(true); expect(c.j.existed).toBe(true);
  });
  test("a failed create is returned as is (no retry loop)", async () => {
    const S = { eid: "x" }; const c = await createFresh(async () => ({ ok: false, s: 400, j: { error: "bad" } }), S, { id: "x" });
    expect(c.ok).toBe(false); expect(S.eidRetries).toBeUndefined();
  });
});
describe("ledger fields", () => {
  test("existed / eidRetries come from the run json", () => {
    expect(eidFields({ existed: true, eidRetries: 2 })).toEqual({ existed: true, eidRetries: 2 });
    expect(eidFields({})).toEqual({ existed: false, eidRetries: 0 }); expect(eidFields(null)).toEqual({ existed: false, eidRetries: 0 });
  });
});
