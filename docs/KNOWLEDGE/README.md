# Knowledge pack: the Corporate Tambola 99% proof programme and its test evidence

Written 14 Nov 2026 by the session that ran the programme (the "games-9999-sampling" side session). Counts only: no secrets, keys, addresses of people, phone numbers, machine addresses or prices are in this folder, because this repository is public.

## In plain English (read this first)

**The goal.** The owner wants Corporate Tambola, the live housie game, to succeed in at least 99 of 100 games, and to be able to say so with 99% confidence. "Succeed" means a whole game runs: the organiser signs in, creates and publishes a game, players join, numbers are called, claims work, and the game ends.

**How we prove it.** Robot players play full games on the real live site, and every game is written to a ledger as clean, failed or "environment" (our own test setup's fault). A fixed piece of mathematics (the pooled method) turns the ledger into one number: the lowest success rate we can honestly claim. Roughly 428 clean games are needed after a fix that restarts the proof for the set-up path; each failure adds more.

**Where we stand (14 Nov 2026).**
- The weakness found on 8 Nov (12 games started in the same second, 9 failed before anyone could join because the shared database was overloaded for 10 seconds) was fixed in code and put live on 13 Nov as commit `c6897f2`.
- One real game on the new version was clean and counts as game 1 of the 428.
- A "burst test" (12 games started within 50 milliseconds) passed cleanly on its third run. The first two runs showed problems in our own test setup, not in the product; they are recorded honestly. Burst games are a separate check and do not count toward the 428.
- The 428-game run itself is on hold: the owner asked for a new version (v2) to be built first, and asked that v2 not be treated as completely new, so a written "carry-over rule" decides which old games still count for it.

## Pages

| Page | What it answers |
|---|---|
| [01-what-and-why.md](01-what-and-why.md) | What was done, in order, and why |
| [02-where.md](02-where.md) | Which repos, files, workflows, ledgers and live hosts |
| [03-how.md](03-how.md) | How to run a test, reproduce one, and read the ledger |
| [04-decisions.md](04-decisions.md) | Owner and manager decisions with dates |
| [05-state-and-numbers.md](05-state-and-numbers.md) | Current counts, burst runs, 428 plan, rollback ids |
| [06-carry-over-rule.md](06-carry-over-rule.md) | How evidence from the old version may count for the new one |
| [07-lessons-and-gotchas.md](07-lessons-and-gotchas.md) | Faults found in the harness and the product, and what they taught |
| [08-open-items.md](08-open-items.md) | What is not done yet |
| [09-handover.md](09-handover.md) | Hand-over note for whoever continues |

## What is deliberately not here
- Keys, tokens, report keys, runner keys and passwords (they live in GitHub Actions secrets and on the owner's machines).
- E-mail addresses, phone numbers and machine addresses or access details (including the second test laptop and the phone worker).
- Prices, plan costs and owner-private reasoning. Only the decision itself is stated.
- Per-row ledger contents (the ledgers stay on the owner's machine; this repo gets only counts and the recipe for reading them).
