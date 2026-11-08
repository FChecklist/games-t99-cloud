# READ-ONLY (usage: live_games_now_game.py <D1 database id> [hours]): which live games are running now or start within the next N hours (counts only, no personal data). Usage: python3 live_games_now.py [hours]
import re, json, sys, time, urllib.request
hours = float(sys.argv[2]) if len(sys.argv) > 2 else 3
import os
env = {k: os.environ[k] for k in ('CLOUDFLARE_D1_TOKEN', 'CLOUDFLARE_ACCOUNT_ID') if k in os.environ}  # cloud lane: from GitHub secrets, never from a file
tok, acct, db = env['CLOUDFLARE_D1_TOKEN'], env['CLOUDFLARE_ACCOUNT_ID'], sys.argv[1]
def q(sql):
    assert sql.lstrip().upper().startswith('SELECT')  # read-only helper
    req = urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{db}/query', data=json.dumps({'sql': sql}).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'tambola-boss/1'})
    try:
        with urllib.request.urlopen(req, timeout=60) as f: d = json.load(f)
    except urllib.error.HTTPError as e: d = json.load(e)
    return d['result'][0].get('results') if d.get('success') else ('ERR', d.get('errors'))
GEN = 1692803367
now = int(time.time())
lo = (now - 3 * 3600 - GEN) // 3 + 1          # started up to 3 h ago (a game lasts well under that)
hi = (now + int(hours * 3600) - GEN) // 3 + 1
rows = q(f"SELECT id, cap, pack, start_round, cancelled_ms, (SELECT COUNT(*) FROM participant p WHERE p.eid=e.id) AS joined FROM engagement e WHERE start_round BETWEEN {lo} AND {hi} AND cancelled_ms IS NULL ORDER BY start_round")
if isinstance(rows, tuple): print(rows); sys.exit(2)
print(f'games started in the last 3 h or starting in the next {hours} h (not cancelled): {len(rows)}')
for r in rows:
    start = GEN + (r['start_round'] - 1) * 3
    print(f"  {r['id'][:12]:12} cap {r['cap']:>5} pack {r['pack']:>5} start in {(start-now)/60:7.1f} min  joined {r['joined']}")
