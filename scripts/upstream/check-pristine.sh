#!/usr/bin/env bash
# Fails if upstream/deeptutor/ differs by even one byte from the DeepTutor release
# pinned in upstream/deeptutor.lock. Vidhya changes belong in vidhya/, never there.
#
#   check-pristine.sh            check HEAD (CI)
#   check-pristine.sh --staged   check what is about to be committed (pre-commit hook)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

want=$(sed -n 's/^tree=//p' upstream/deeptutor.lock)
tag=$(sed -n 's/^tag=//p' upstream/deeptutor.lock)
[ -n "$want" ] || { echo "upstream/deeptutor.lock has no tree= line" >&2; exit 2; }

if [ "${1:-}" = "--staged" ]; then
  have=$(git rev-parse "$(git write-tree):upstream/deeptutor")
else
  have=$(git rev-parse "HEAD:upstream/deeptutor")
fi

if [ "$have" != "$want" ]; then
  echo "FAIL: upstream/deeptutor/ is not the pristine DeepTutor $tag." >&2
  echo "  expected tree $want" >&2
  echo "  found tree    $have" >&2
  echo "Changed paths:" >&2
  git diff --stat "$want" "$have" >&2 || true
  echo "Fix: move the change into vidhya/ (plugin, branding or patches/deeptutor/)," >&2
  echo "     or upgrade with scripts/upstream/sync-deeptutor.sh <tag>." >&2
  exit 1
fi
echo "OK: upstream/deeptutor/ matches DeepTutor $tag ($want)."
