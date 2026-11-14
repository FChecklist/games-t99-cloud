// 13 Nov 2026 (TARGET-99 Tambola plan): the 8 Nov bursts came from the TEST, not from a guest crowd: twelve games started their set-up (sign-in, create, publish) in the same second and
// D1 answered "overloaded, 10 second window". The first start of each worker is staggered already; this gate also spaces every LATER start on one machine (workers drift back together),
// and cools the whole machine down for a minute after any "busy" answer, so one burst cannot snowball into the next. Harness only: it never replaces the product's own retry.
export function makeSetupGate({ gapS = 0, busyCoolS = 60, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), rand = Math.random } = {}) {
  let next = 0, busyUntil = 0;
  return {
    /** Waits until this machine may start another game's set-up. Slots are handed out one after another, gapS apart (+/-20 %). */
    async slot() {
      if (!(gapS > 0)) return 0;
      const n = now(), at = Math.max(n, next, busyUntil);
      next = at + Math.round(gapS * 1000 * (0.8 + rand() * 0.4));
      if (at > n) await sleep(at - n);
      return at - n;
    },
    /** Tell the gate what the last game said; a busy / 503 answer holds every new start for busyCoolS seconds. */
    sawAnswer(why) { if (/site busy|It is busy right now|very busy|-> 503\b|overloaded/i.test(String(why || ""))) { busyUntil = Math.max(busyUntil, now() + busyCoolS * 1000); return true; } return false; },
  };
}
