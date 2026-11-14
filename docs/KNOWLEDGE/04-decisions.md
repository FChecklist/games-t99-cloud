# 04. Decisions, with dates

"Owner" decisions reached the programme through the manager session ("BOSS"). Wording is paraphrased; the verbatim record is in the owner's release log.

| Date (2026) | Decision | By |
|---|---|---|
| 13 Nov | Corporate Tambola must reach 99% success with 99% confidence, using the pooled method unchanged (5 modules, Jeffreys prior, lower 99% credible bound, Clopper-Pearson cross-check). The 8 Nov burst failures count as product failures. | Owner |
| 13 Nov | Use the 428-game count (restart of the set-up path's evidence) and go ahead with the deploy of `c6897f2`. | Owner |
| 13 Nov | The one live smoke game counts as game 1 of 428. | Owner |
| 13 Nov | Run the burst test at a quiet time, robots and test organisers only, with zero live games before and during; continue only if it passes. | Owner |
| 13 Nov | Use the second laptop and the phone for Tambola testing (robots only). Details of those machines are deliberately not published. | Owner |
| 13 Nov | Run 1 of the burst test is logged as "partial pass, environment problems". Run 2's six failures stay recorded as failures with a note. Burst games are a separate check and do NOT count toward the 428. Run a third burst once. | Manager (BOSS) |
| 13 Nov | New order: build the new version (v2) first rather than playing the 428 games now; v2 is not new game rules, so do not treat it as completely new. Phase 2 (the 428 games) is held until v2 exists. | Owner |
| 13 Nov | Burst-test design: GO for the canary at a quiet time; Phase 3 (1000-player capacity ladder on a separate staging copy, never the live database, never during a customer's game) and the 50-person real-phone rehearsal stay on hold. | Owner / manager |
| 14 Nov | Recommendation to merge PR 11 and close PR 10 was accepted in principle, then put on hold again: PR 11 shows no CI checks and its base is a release-candidate branch, so the owner will be asked first. | Manager |
| 14 Nov | Put the complete knowledge of this project into the existing GitHub repos (this folder). No new repo; no secrets. | Owner |

## Standing rules (always)
No paid steps; robots only; zero live games before and during a run; no live deploy without the owner's go and a rollback id; ledger rows never deleted or edited; no reclassification without a ruling; light use of the main laptop (user memory first).
