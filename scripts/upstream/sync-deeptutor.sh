#!/usr/bin/env bash
# Upgrades upstream/deeptutor/ to a DeepTutor release tag, then proves Vidhya still builds on it.
#
#   scripts/upstream/sync-deeptutor.sh v1.8.0
#
# Replaces the whole folder with the release tree (no hand edits survive by design),
# rewrites upstream/deeptutor.lock, re-applies vidhya/ on top via assemble.sh, and commits.
# If a Vidhya patch no longer applies, it stops before committing: refresh the patch, rerun.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

tag=${1:?usage: sync-deeptutor.sh <release tag, e.g. v1.8.0>}
repo=$(sed -n 's/^repo=//p' upstream/deeptutor.lock)
old=$(sed -n 's/^tag=//p' upstream/deeptutor.lock)

git diff --quiet && git diff --cached --quiet || { echo "Working tree not clean; commit or stash first." >&2; exit 2; }

git fetch -q --depth 1 "$repo" "+refs/tags/$tag:refs/upstream-tmp/deeptutor"
commit=$(git rev-parse "refs/upstream-tmp/deeptutor^{commit}")
tree=$(git rev-parse "refs/upstream-tmp/deeptutor^{tree}")

git rm -r -q --cached upstream/deeptutor
rm -rf upstream/deeptutor
git read-tree --prefix=upstream/deeptutor/ -u "$tree"

cat > upstream/deeptutor.lock <<EOF
# Pinned DeepTutor release. Written only by scripts/upstream/sync-deeptutor.sh.
repo=$repo
tag=$tag
commit=$commit
tree=$tree
license=$(head -c 200 upstream/deeptutor/LICENSE | grep -qi 'Apache License' && echo Apache-2.0 || echo CHECK-LICENSE)
EOF
git add upstream/deeptutor.lock

if grep -q CHECK-LICENSE upstream/deeptutor.lock; then
  echo "STOP: DeepTutor $tag is no longer Apache-2.0. Review the licence before shipping." >&2; exit 3
fi

scripts/upstream/check-pristine.sh --staged
out=$(mktemp -d)
scripts/upstream/assemble.sh "$out/deeptutor"   # fails if any vidhya patch no longer applies

# The Exam Brain reads GET /api/auth/status with the dt_token cookie (plan T15).
if ! python3 -I scripts/upstream/check-auth-contract.py upstream/deeptutor; then
  echo "STOP: DeepTutor $tag changed the auth contract the Exam Brain depends on. Update vidhya/brain/src/session before syncing." >&2; exit 4
fi

git commit -q -m "Sync DeepTutor $old -> $tag (${commit:0:8})

Upstream: $repo/releases/tag/$tag
Vidhya layer re-applied cleanly by scripts/upstream/assemble.sh."
echo "Synced DeepTutor $old -> $tag. Run the app smoke tests before merging."
