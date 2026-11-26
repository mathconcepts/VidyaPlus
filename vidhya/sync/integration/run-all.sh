#!/usr/bin/env bash
# Everything the brain-integration job runs, in order. Locally: SUDO=sudo ./run-all.sh
# Exit non-zero on the first failing stage; the stack is left up for inspection (./down.sh).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC="$(cd "$HERE/.." && pwd)"
[ -d "$SYNC/node_modules" ] || (cd "$SYNC" && npm ci)
[ -d "$SYNC/../brain/node_modules" ] || (cd "$SYNC/../brain" && npm ci)
(cd "$SYNC" && npm run build >/dev/null)
"$HERE/up.sh"
cd "$SYNC"
echo "== session contract (S1, brain resolver vs real DeepTutor)"
npm run test:integration
echo "== S1 + S3 + S-sync checks"
python3 integration/s3_checks.py
echo "== S2 checks"
python3 integration/s2_checks.py
echo "== tutor chat smoke (gated)"
python3 integration/chat_smoke.py
