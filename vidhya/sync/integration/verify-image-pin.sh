#!/usr/bin/env bash
# The compose file pins DeepTutor by image digest. This proves the image's python
# package is byte-identical to upstream/deeptutor/deeptutor (the v1.7.3 pin), so
# the sync applier, which imports DeepTutor's own store code, runs against exactly
# the code the repo vendors. Exit 1 if they differ.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DOCKER="${SUDO:-} docker"
IMG="$(sed -n 's/^ *image: *\(ghcr.io\/hkuds\/deeptutor@sha256:[0-9a-f]*\) *$/\1/p' "$HERE/docker-compose.yml")"
[ -n "$IMG" ] || { echo "no pinned deeptutor image in docker-compose.yml" >&2; exit 1; }
$DOCKER image inspect "$IMG" >/dev/null 2>&1 || $DOCKER pull "$IMG" >/dev/null
TMP="$(mktemp -d)"; trap '${SUDO:-} rm -rf "$TMP"' EXIT   # docker cp output is owned by docker's user
cid="$($DOCKER create "$IMG")"
$DOCKER cp "$cid:/app/deeptutor" "$TMP/deeptutor" >/dev/null; $DOCKER rm "$cid" >/dev/null
tree() { (cd "$1" && find deeptutor -name __pycache__ -prune -o -type f -print | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1); }
a="$(tree "$TMP")"; b="$(tree "$ROOT/upstream/deeptutor")"
if [ "$a" != "$b" ]; then echo "IMAGE PIN MISMATCH: image $a != upstream/ $b" >&2; exit 1; fi
echo "image pin ok: $IMG matches upstream/deeptutor ($b)"
