#!/usr/bin/env bash
# Start the pinned DeepTutor + redis, with auth enabled, an admin and one
# SYNTHETIC test student. Safe to re-run. Needs docker (use SUDO=sudo if the
# daemon needs it) and curl + python3.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
DOCKER="${SUDO:-} docker"
# Container-written state lives outside the source tree: DeepTutor writes it as its own user
# with private modes, and anything under the repo gets scanned by vitest/tsc/git.
export VIDHYA_IT_STATE="${VIDHYA_IT_STATE:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/vidhya-it}"
export DT_DATA="${DT_DATA:-$VIDHYA_IT_STATE/data}"
export VIDHYA_SYNC_DIR="${VIDHYA_SYNC_DIR:-$HERE/..}"
BACKEND="http://127.0.0.1:${DT_BACKEND_PORT:-8001}"
ADMIN_USER="${IT_ADMIN_USER:-it-admin}"
ADMIN_PASS="${IT_ADMIN_PASS:-it-admin-pass-1234}"
STUDENT_USER="${IT_STUDENT_USER:-it-student-1}"
STUDENT_PASS="${IT_STUDENT_PASS:-it-student-pass-1234}"

"$HERE/verify-image-pin.sh"

mkdir -p "$DT_DATA/user/settings"
# DeepTutor's Docker entrypoint ignores AUTH_* env names and reads settings JSON.
cat > "$DT_DATA/user/settings/auth.json" <<JSON
{"version": 1, "enabled": true, "username": "admin", "password_hash": "",
 "token_expire_hours": 24, "cookie_secure": false, "private_login_hosts": []}
JSON
# The entrypoint remaps the in-container user to uid/gid 1000 and chowns /app/data.
chmod -R a+rwX "$DT_DATA" 2>/dev/null || true
# The brain image runs as `node` (uid 1000); a bind dir docker creates would be root-owned.
export BRAIN_DATA="${BRAIN_DATA:-$VIDHYA_IT_STATE/brain}"
mkdir -p "$BRAIN_DATA/backups"
chmod -R a+rwX "$BRAIN_DATA" 2>/dev/null || true

# Pass the state dirs explicitly: `sudo` drops exported variables, and compose would then mount its
# fallback dirs instead of the ones prepared above.
COMPOSE=(${SUDO:-} env DT_DATA="$DT_DATA" BRAIN_DATA="$BRAIN_DATA" ${COMPOSE_FILE:+COMPOSE_FILE="$COMPOSE_FILE"} docker compose)
"${COMPOSE[@]}" up -d
echo "waiting for DeepTutor /health/ready ..."
for i in $(seq 1 90); do
  if curl -fsS "$BACKEND/health/ready" >/dev/null 2>&1; then break; fi
  sleep 3
  if [ "$i" = 90 ]; then echo "DeepTutor did not become ready" >&2; "${COMPOSE[@]}" logs --tail=80 deeptutor >&2; exit 1; fi
done

# Bootstrap admin (open only while the user store is empty), then the student.
JAR="$HERE/.run/admin.cookies"; mkdir -p "$HERE/.run"
if [ "$(curl -fsS "$BACKEND/api/auth/is_first_user" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("is_first_user"))')" = "True" ]; then
  curl -fsS -X POST "$BACKEND/api/auth/register" -H 'content-type: application/json' \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" >/dev/null
fi
curl -fsS -c "$JAR" -X POST "$BACKEND/api/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" >/dev/null
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BACKEND/api/auth/users" -H 'content-type: application/json' \
  -d "{\"username\":\"$STUDENT_USER\",\"password\":\"$STUDENT_PASS\"}")
case "$code" in 200|201|409) ;; *) echo "creating the test student failed: HTTP $code" >&2; exit 1;; esac
echo "stack up: $BACKEND  (admin=$ADMIN_USER student=$STUDENT_USER)"
