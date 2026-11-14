# 03. How to run, reproduce and read

## Plain English
A test is a button in GitHub Actions. Before pressing it, check that no real person is playing. After it, download the result file and read the one-line-per-game ledger.

## Before every run (all must hold)
1. No real game is live or about to start. Run `python tools/live_games_now.py 3` (games started in the last 3 hours or starting in the next 3). Robot games are named with a prefix such as `SMK10M-`; any other line is a real game: do not run.
2. A rollback id for the live version is written in the release log first.
3. Robots and test organisers only, no paid step.
4. The harness gate refuses to start when it sees a real game (the run then waits 5 minutes and tries again).

## Run it
GitHub, repository `games-t99-cloud`, Actions, "t99 cloud sampling", Run workflow. Inputs:
- `games`: which game lanes (here `tambola`)
- `jobs`: parallel machines (1 to 8), `hours` up to 5, `workers`, `per_site`
- `sizes`: player counts, `org_spread`, `team_rate`
- smoke only: `max_runs` (stop after that many games)
- burst branch only: `burst=1` makes every worker wait at a barrier and start at the same instant

Results come back as workflow artifacts `ledger-cloudN`, each containing `ledger-cloudN.jsonl`, a run log and a database-watch log.

## Reading a ledger row
Fields of one row (JSON line): `at` (time), `machine`, `game`, `size` (players), `ua` (desktop or mobile), `band` (day/evening/night), `rejoins`, `id` (game id), `kind` (`clean`, `fail`, `env`), `why`, `outcome`, `joined`, `ended`, `secs`, `version`, `commit`, `unexpected`, `answers` (count of unexpected answers by status), `existed`, `eidRetries`, `netBlips`, `requests`, `exit`.

- **clean**: the game ended, at least 95% of players joined, no unexpected answers.
- **fail**: the product, or the harness in a way that hides a product result, did not finish. Counted against the product unless the owner rules otherwise.
- **env**: our side (test machine, gate). Not counted. Cloud rows that stopped at set-up are treated by the engine as failures (strict mode).
- Rows are never deleted or edited. Reclassification needs a written ruling and is a new row or a note, not an edit.

## Turning rows into the claim
1. Append the run's rows to the ledger (backup first).
2. Run the engine with a 0.99 target: `CONF=0.99 TARGETS=0.99 python pool_99.py` (view A and view B must agree).
3. The engine multiplies five module results (join, rejoin, call, claim, payfree), each from a Jeffreys prior, and reports the lower 99% credible bound. A Clopper-Pearson bound is printed beside it as a stricter cross-check.

## Reproducing the burst test
Use the burst branch, workflow input `burst=1`, `max_runs=12`, one job with 12 workers. Expect: all 12 games set up within 50 ms of each other, every game joins 20 of 20, every game ends with confirmation, and zero busy/503/overload lines. The database error log is read-only during the run.

## Checking the live version
`/version.json` on the live host must equal the commit that was meant to go live. Then a smoke game (1 game, `max_runs=1`).
