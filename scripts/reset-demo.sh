#!/usr/bin/env bash
# Reset only the demo deployment explicitly selected by BASE_URL.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BASE_URL:?Set BASE_URL to your deployed demo URL}"
: "${CONFIRM_REMOTE:?Set CONFIRM_REMOTE=1 to reset the selected deployment}"
[ "$CONFIRM_REMOTE" = 1 ] || { echo "CONFIRM_REMOTE must be 1" >&2; exit 1; }
selected_url="$BASE_URL"
set -a; . ./.prod.vars; . ./.dev.human; set +a
export BASE_URL="$selected_url" CONFIRM_REMOTE=1
auth="authorization: Bearer $SEED_API_KEY"
for attempt in 1 2 3; do
  if curl -fsS --max-time 540 -X POST "$BASE_URL/admin/cleanup-forks?confirm=1" -H "$auth" -H "x-agent-run-id: reset" \
     && node --experimental-strip-types scripts/demo-seed.mjs; then break; fi
  [ "$attempt" = 3 ] && { echo "reset failed after 3 attempts" >&2; exit 1; }
  echo "reset attempt $attempt failed; retrying" >&2; sleep 5
done
# Escape SQL literals and require an existing human account.
email_sql="${DEMO_HUMAN_EMAIL//\'/\'\'}"
pnpm exec wrangler d1 execute DB --remote --command "UPDATE user SET role='decider' WHERE email='$email_sql'"
echo "Reset complete. The human must have signed up before this reset."
