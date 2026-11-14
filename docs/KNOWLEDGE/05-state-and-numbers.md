# 05. Current state and numbers (14 Nov 2026)

## Live version and rollback ids
| Item | Value |
|---|---|
| Live version | `c6897f2` (deployed 13 Nov) |
| Live deployment id | `06b05751-7b99-41a9-a69d-7550d60755ab` |
| Rollback id (version before: `c9d34f3`, v1.9.0) | `b85cd98e-54fc-419d-937c-a8fe9e9f61db` |
| Pull requests (corporate-tambola) | PR 11 (live code, unmerged, base is a release-candidate branch, no CI checks shown); PR 10 (older, contained in PR 11, unmerged) |
| Harness branches | burst `c9c4de9`, smoke `0dc21f0`, set-up gate `a3a69d9` |

## Why 428
Before the fix: 153 payfree (set-up path) failures in 1,727 payfree trials, all on `c9d34f3`, 150 of them from D1 database overload bursts (59 of those inferred from timing, not from a stored answer). With that history 99% at 99% needs about 17,000 more clean games (not feasible). Because the set-up path was genuinely rewritten, its counts restart on the new version; with the other three modules' old evidence kept (join 45,876 sessions with 3 failures; call 1,736 games with 3; claim 1,739 with 0) the engine needs **428 failure-free whole games**. An independent check of the same arithmetic gives 430.

| New failures on the new version | Games needed (Jeffreys) |
|---|---|
| 0 | about 430 |
| 1 | about 710 |
| 2 | about 920 (the plan size) |
| whole-version restart, 0 failures | about 754 |

Clopper-Pearson (stricter, Bonferroni over 5 modules): about 1,560 games with 0 failures, 2,120 with 2. The programme's "reached" has always meant the Jeffreys bound; CP is shown beside it.

Mix: 50% 20-player, 35% 100-player, 15% 250-player; three time bands; desktop and mobile. 18 cells.

## Evidence count on the new version
| Item | Count |
|---|---|
| Games counted toward the 428 | 1 (the smoke game, run 43410065997: 20 of 20 joined, ended, clean) |
| Games still needed | 427 clean with zero failures (more if any fail) |
| Ledger `suite/lc.jsonl` | 4,455 rows in total across all versions |

## Burst test results (not counted toward the 428; 37 rows kept in a separate log)
| Run | Date | Result |
|---|---|---|
| 1 | 13 Nov | 12 set-ups, 12 got 20 of 20 players, zero busy answers; 6 clean, 6 environment (test account lost its key, not a product failure); starts about 6 seconds apart |
| 2 | 13 Nov | Start barrier worked; zero busy answers; 6 clean, 6 recorded as failures (the test account's login was lost mid-game; the harness could not recover) |
| 3 | 13 Nov | **Clean pass:** 12 started within 50 ms, 12 set up, 20 of 20 joined in each, all 12 ended and confirmed, zero busy/503/overload lines; one extra clean game afterwards |

Limits of this evidence: one shared test organiser with repeated fresh sign-in (only three test logins exist in the product's code), 20-player games, one cloud machine. A 12-different-accounts burst, and 100/250-player cloud runs, are untested.

## Throughput (measured)
A game lasts about 19.7 minutes whatever its size, so speed equals parallel games. Cloud runner: about 24 clean games per hour. Other machines: projected from smaller samples only.
