#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
${SUDO:-} docker compose down -v --remove-orphans
if [ "${1:-}" = "--wipe" ]; then ${SUDO:-} rm -rf "$HERE/.run"; fi
