# 01. What was done, and why

## Plain English
The proof had a hole: 12 games starting at the same second overloaded the live database and most failed. We wrote down every failure and its cause, fixed the set-up path of the game, put the fix live under strict safety rules, played one real robot game, and then re-ran the same 12-at-once test until it passed cleanly. Along the way we found and fixed three faults in our own test harness, and designed a rule for how much of the old evidence may carry over to the next version.

## Timeline (all 2026)
| Date | What | Why |
|---|---|---|
| 8 Nov | Two bursts (about 125 and 27 failed games) on version `c9d34f3` | Many test machines started set-ups in the same second; the product answered "busy" and never retried |
| 13 Nov, Phase 0 | Root-cause table for all 153 set-up failures, the "release rule" analysed, scenarios computed (plan file in the owner's handover folder; its numbers are summarised in [05](05-state-and-numbers.md)) | The owner required 99% at 99% confidence; the order of work had to be proven feasible first |
| 13 Nov, Phase 1 | Product fixes on branch `t99/setup-path-2026-11-13`, audited independently | Make sign-in, create, publish and leave survive a short database overload |
| 13 Nov | Harness: set-up gate, stagger, ledger improvements (this repo) | The harness must never be what breaks the product |
| 13 Nov | Deployed `c6897f2` live, rollback id recorded first | The owner ruled to use the 428 count and go ahead |
| 13 Nov | One smoke game, counted as game 1 of 428 | Cheapest real check after a live change |
| 13 Nov | Burst test, three runs (partial pass, fail from test setup, clean pass) | Prove the 8 Nov failure no longer happens |
| 13 Nov | Carry-over rule designed and audited (nine revisions) | Owner: the new version is not new game rules, do not treat it as completely new |
| 14 Nov | This knowledge pack | Owner order: write the project's knowledge into GitHub |

## What the product fix changed (commit `c6897f2`, in the corporate-tambola repository, PR 11 on branch `t99/setup-path-2026-11-13`)
- Sign-in, create-game, publish and leave now repeat for a moment when the database says it is overloaded, instead of answering "busy" at once.
- Create and the first pack link are one atomic database batch (nothing half-made).
- The consent record is written in the same batch as publish.
- One publish mail only: an idempotency key per game plus a single-sender marker, so two tabs cannot send twice.
- A sign-in attempt is counted exactly once, even when the request is repeated.
- Three new database indexes (migration 31).

The older, smaller fix (PR 10) is contained in PR 11. Neither PR is merged at the time of writing; the live site was deployed straight from the PR 11 branch. Merging and closing are waiting for the owner.

## Why the harness work mattered
All Tambola evidence is produced by robots playing the real live site. If the robots themselves overload the site or lose their own login mid-game, the ledger would blame the product for our faults, or hide real faults. Each harness fault found (see [07](07-lessons-and-gotchas.md)) was fixed or recorded openly, and no ledger row was ever deleted or edited.
