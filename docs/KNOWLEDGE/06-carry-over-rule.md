# 06. Carry-over rule (how old evidence may count for the next version)

Status: designed and independently audited (nine revisions, last one `AUDIT: PASS`) on 13 Nov 2026. Not yet applied: it waits for the diff summary of v2. The full 24 KB text is on the owner's machine; this page is the digest.

## Plain English
A game played on the old version counts for the new version only for the parts of the product that the new version did not touch, and only when that can be shown mechanically, not promised. Changed parts and parts that run through changed shared code start again with fresh games. At the end a smaller confirmation batch is played on the exact final version. Old and new games are always shown separately.

## Rules in short (R1 to R10)
1. **Units:** the five modules (join, rejoin, call, claim, payfree) and the strata (20/100/250 players, desktop/mobile, time band). Evidence is keyed to the commit and Worker version.
2. **Mechanical UNCHANGED test:** a module is UNCHANGED only if nine checks pass: executed function bodies, SQL strings and counts and rows, schema, client bundles, config and environment, the whole call closure (with bundle hashes settling only two of the checks), lockfile/toolchain, fault-injection replays, replays at all sizes and devices with and without the runner key, and real database measurements on the same snapshot. A negative control (a deliberate change must flip the result) is required.
3. **Load and shared budget:** extra database statements per request or the shared daily write budget make a module CHANGED even if its own lines are not.
4. **Carry-over:** UNCHANGED carries; CHANGED carries zero; NEW paths are counted separately against a path registry fixed before play; failures from before the fix are listed and counted in the strict bound.
5. **Fresh games** for every CHANGED module and every new path.
6. **Clock tests** (not counted as games) for the 24-hour game key expiry.
7. **Confirmation batch:** 90 attempted games plus three bursts on the exact final commit; restarts capped at one per module; a lineage ledger; mechanical environment exclusion capped at three.
8. **Labels** are tied to the commit and Worker version and only ever move toward CHANGED.
9. **Three bounds are always printed:** HEADLINE, ALL-LINEAGE and STRICT. Clopper-Pearson with alpha divided by the number of modules is used on the strict counts. Each size needs at least 100 games and its own four figures at or above 0.99. TIER 1 wording is "at or above 0.99 (credible)"; TIER 2 wording "99% confidence" needs the CP bound at or above 0.99.
10. **Dry run** on the real v2 diff first, before any game is labelled.

## Reachability
About 750 clean games per module for the Jeffreys joint bound and about 3,100 for the CP bound at alpha/5. 428 clean games gives only about 98% on the strict reading, so the honest wording for 428 is TIER 1 at best.

## Open item
The replay harness (rule 2) and its negative controls still have to be built and audited.
