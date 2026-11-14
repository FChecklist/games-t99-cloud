# 09. Hand-over note

Written by the programme session on 14 Nov 2026 for whoever continues (a human or another AI session).

## If you only have five minutes
1. Live is `c6897f2`; rollback id `b85cd98e-54fc-419d-937c-a8fe9e9f61db`. Nothing was changed on the live site after the 13 Nov deploy.
2. The evidence count is 1 of 428. The burst test passed cleanly on its third run; those games are NOT part of the count.
3. Phase 2 is on hold until the new version (v2) exists. When its diff summary arrives, apply [the carry-over rule](06-carry-over-rule.md), starting with its dry run.
4. PR 11 and PR 10 are not merged. Do not merge or deploy without the owner's go.
5. Before any run: check no real game is live (`tools/live_games_now.py`), write the rollback id, robots only, no paid steps.

## Order of work from here
1. Read [05](05-state-and-numbers.md) and [08](08-open-items.md).
2. When v2's diff summary exists: label each module with the raw diff (not the old normaliser), write the table to a file and commit it before any fresh game counts.
3. Build the replay harness and negative controls; get an independent audit comment (`AUDIT: PASS`) before relying on carried evidence.
4. Fresh batches: cloud first, then the other machines for the larger sizes (their access details are held by the owner, not in this repository). Record which machine ran each game.
5. Re-run the pooled engine after every batch; stop when the claim is reached or a failure forces a restart. Any new fix mid-run restarts that module's count, so ship all known fixes before the first evidence game.
6. FINAL: the steps listed in item 10 of [08](08-open-items.md).

## Never
Delete or edit a ledger row; relabel a failure to reach a number; run during a customer's game; print or commit a key; let the harness cause the load it is meant to survive.
