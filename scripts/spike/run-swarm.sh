#!/bin/sh
# Seeds a fresh set of 10 tasks, runs N agents until the ready list is empty, then verifies every submission.
# Usage: scripts/spike/run-swarm.sh [workers=3] [leases=0]   Env: BASE_URL, SCRATCH. Sources .dev.vars.
cd "$(dirname "$0")/../.." || exit 1
set -a; . ./.dev.vars; set +a
export BASE_URL="${BASE_URL:-http://localhost:18790}"
WORKERS="${1:-3}"; LEASES="${2:-0}"
REPO=$(node --experimental-strip-types scripts/spike/seed.ts 2>&1 | grep -v Warning | tail -1)
echo "repo=$REPO workers=$WORKERS leases=$LEASES"
curl -s -N -m 900 -X POST "$BASE_URL/swarm/run?workers=$WORKERS&maxTasks=50&leases=$LEASES&repositoryId=$REPO" -H "authorization: Bearer $SEED_API_KEY" | python3 -c "
import sys,json,collections
for l in sys.stdin:
    d=json.loads(l)
    if 'result' in d:
        r=d['result']; t0=r[0]['t']; c=collections.Counter(s['event'] for s in r)
        for s in r:
            if s['event'] in ('claimed','submitted','task_failed','llm_bad_output','lease_denied','retry','claim_rejected'): print(round((s['t']-t0)/1000,1), s['agent'], s['event'], json.dumps(s.get('detail'))[:160])
        print('span %.1fs'%((r[-1]['t']-t0)/1000), dict(c))
        json.dump(r, open('results/swarm-%d-agents-%d.json'%(int($WORKERS), t0), 'w'), indent=1)
    elif 'error' in d: print('ERROR', d['error'])
"
REPO=$REPO node --experimental-strip-types scripts/spike/gate5.ts 2>&1 | grep -v Warning
