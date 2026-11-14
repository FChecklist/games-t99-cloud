# 02. Where everything is

## Repositories (all public on GitHub, owner organisation `FChecklist`)
| Repo | Role |
|---|---|
| `games-t99-cloud` (this one) | Harness: the robot players, the safety gates, the workflows that run them on GitHub-hosted machines, and this knowledge pack |
| `corporate-tambola` | The Tambola product (edge Worker, pages, tests, migrations). The fixed version is PR 11, branch `t99/setup-path-2026-11-13` |
| `games-testing` | Earlier test material for the other games |

## Harness files (this repo)
| Path | What it is |
|---|---|
| `.github/workflows/t99.yml` | The workflow "t99 cloud sampling": dispatch inputs `games`, `jobs`, `hours`, `workers`, `per_site`, `sizes`, `org_spread`, `team_rate`; on the burst branch also `max_runs` and `burst` |
| `.github/workflows/t99-sites.yml` | The same idea for the sites lane |
| `live/t99.mjs` | The worker loop: pick a cell, check the live state, check the live commit, start one game run |
| `live/run.mjs` | Plays one game from set-up to end and writes one ledger row; refuses to start when a real (non-robot) game is running |
| `live/lib.mjs`, `live/common.mjs`, `live/scenario.mjs` | Shared helpers, the step list of a game, scenario definitions |
| `live/setup-gate.mjs` (+ test) | Spreads set-ups apart so a burst cannot come from us |
| `live/gate-watch.mjs`, `live/gate-status.json` | The "real game is running" safety gate |
| `live/d1-watch.mjs` | Watches the database error log during a run (read-only) |
| `live/t99-eid.test.mjs`, `live/t99-unpaid.test.mjs` | Harness unit tests |
| `tools/live_games_now.py` | Lists games started in the last N hours or starting soon; used before and during every run |

## Branches carrying unmerged work (harness repo)
| Branch | What it adds |
|---|---|
| `t99/setup-gate-2026-11-13` | The set-up gate (first pull request of the harness) |
| `t99/one-game-smoke-2026-11-13` | A switch to stop after one game (`max_runs`), used for the smoke game |
| `t99/burst-canary-2026-11-13` | `burst` mode: start barrier, same-instant start, higher sign-in cap, re-sign-in after a retired key |

## Live product
- Live host: `housie.corporatetambola.com` (Cloudflare Pages + Worker + a D1 database). Live version file: `/version.json`.
- Error box and telemetry report are on the same host (`/api/blackbox`, `/api/telemetry`, both need a report key held by the owner). The bare domain `corporatetambola.com` redirects elsewhere and drops the key.
- The release procedure is a script in the owner's handover folder; the rule is: rollback id first, zero live games, version file equals the commit, smoke after.

## Ledgers and plans (kept on the owner's machine, not in GitHub)
| File | What it holds |
|---|---|
| `suite/lc.jsonl` | One row per cloud game: the 428 evidence ledger (4,455 rows at 14 Nov) |
| `suite/lp.jsonl`, `suite/lh.jsonl` | Phone and laptop ledgers |
| `suite/burst-log.jsonl` | Burst test rows only (37 rows); not read by the engine |
| `TARGET-9999-LEDGER.md`, `-POOLED.md`, `-CLAIMS.md`, `-CLASSIFICATIONS.md` | Generated reports from the pooled engine |
| `TARGET-99-TAMBOLA-PLAN-2026-11-13.md` | The Phase 0 plan |
| `RELEASE-LOG-2026-11-02.md` | Every deploy and every test run, one row each, with rollback ids |

The pooled engine is `pool_99.py` / `pool_engine.py` in the owner's scratch folder. It reads the ledgers, and `module_diff.py` supplies the release-rule weights.
