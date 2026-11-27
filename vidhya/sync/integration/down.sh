#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
${SUDO:-} docker compose down -v --remove-orphans
STATE="${VIDHYA_IT_STATE:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/vidhya-it}"
if [ "${1:-}" = "--wipe" ]; then ${SUDO:-} rm -rf "$HERE/.run" "$STATE"; fi
