# 07. Lessons and gotchas

## Product
- **D1 limit is per database per 10 seconds,** shared by every organiser and game. Twelve simultaneous set-ups were enough to hit it on 8 Nov. Sign-in, create and publish used to be "answer busy at once, never retry"; they now repeat briefly. This fault was old: 155 overload errors were seen between 26 Oct and 8 Nov.
- **The site keeps only the newest 6 organiser keys per account.** A shared test account that signs in more than six times loses its oldest keys, and a game still running on a lost key gets "not allowed" or "please sign in". That is a test-account property, not a product failure, but it hides real results if the harness cannot sign in again.
- **There is one shared daily write budget** for the whole site; heavy test days draw on it.
- **Robot games bypass the per-address join guard** through a runner key (kept off GitHub), so robot results say nothing about how the guard treats real phones behind shared carrier addresses.

## Harness faults found (and what was done)
| Fault | Evidence | Fix |
|---|---|---|
| Burst canary run 1: six games ended without confirmation (403 "Not allowed") | Newest-6-keys trim confirmed in code and on the live database (exactly six keys left for the one organiser that owned all 12 games) | Re-sign-in at the end step |
| Starts were about 6 seconds apart, not at the same instant | Workflow stagger values were 0; the runner chose its 12 games one after another, about 6.2 s each | Start barrier: every worker waits and starts together |
| Run 2: six failures with "please sign in" mid-game | One re-login attempt was starved by sign-in contention on one account | Up to six jittered re-sign-ins and a higher per-process sign-in cap in burst mode |
| Run 2's first wave refused by the safety gate | The gate saw run-1 robot games inside its window | Working as designed; the run waited five minutes and started cleanly |
| Test-game ids collided now and then | Ids came from 16^5 values | Ids from 36^5, fresh id plus retry when create answers "existed" |
| Unexpected answers were only a total | Hard to diagnose per row | Each ledger row now keeps `{answer: count}` |
| `module_diff.py` shows zero changed lines for a real fix | Its normaliser strips string contents and comments first | Reported, not changed; the carry-over rule uses the raw diff instead |

## Method
- Do not assume a cause; prove it from the code line and the live data (done for the key trim and the 6-second spacing).
- Keep failed runs in the record with a note. The first burst run was logged as a partial pass, not a pass.
- Treat the harness as part of the system under test: it must never be the load that breaks the product.
- Cloud runner logs: `gh run view --log` often fails; the jobs API log endpoint works. GitHub itself is sometimes unreachable; retry on a timer.
- Windows shell quirks seen: shell heredocs cannot see `/tmp`; harness files use CRLF line endings, so patch scripts must preserve them; long command output can be truncated, so re-run with a structured parser.
