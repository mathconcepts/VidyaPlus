#!/usr/bin/env bash
# Builds the Vidhya app: a copy of pristine DeepTutor with the Vidhya layer applied on top.
# upstream/deeptutor/ is only ever read here, never written.
#
#   scripts/upstream/assemble.sh build/vidhya-app
#
# Order (least invasive first):
#   1. copy upstream/deeptutor/
#   2. apply vidhya/patches/deeptutor/*.patch in name order (fails loudly if one no longer applies)
#   3. rebrand UI text in web/locales/** (vidhya/branding/rebrand_locales.py)
#   4. copy vidhya/branding/public/** over web/public/
#   5. write NOTICE-VIDHYA.md (Apache-2.0 s.4: state that files were changed)
# Vidhya plugins (vidhya/plugins/*) are installed into the running app with
# `deeptutor plugin`, not copied into its source tree.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
out=${1:?usage: assemble.sh <output dir>}
[ -e "$out" ] && { echo "$out exists; pass a new directory" >&2; exit 2; }

mkdir -p "$out"
cp -a "$root/upstream/deeptutor/." "$out/"

shopt -s nullglob
patches=("$root"/vidhya/patches/deeptutor/*.patch)
for p in "${patches[@]}"; do
  if ! (cd "$out" && git apply --check -p1 "$p"); then
    echo "FAIL: $(basename "$p") no longer applies to DeepTutor $(sed -n 's/^tag=//p' "$root/upstream/deeptutor.lock")." >&2
    echo "Refresh it against the new release, or replace it with a plugin/branding change." >&2
    exit 1
  fi
  (cd "$out" && git apply -p1 --whitespace=nowarn "$p")
done

python3 -I "$root/vidhya/branding/rebrand_locales.py" "$root/vidhya/branding/brand.json" "$out/web/locales"

if [ -d "$root/vidhya/branding/public" ]; then
  cp -a "$root/vidhya/branding/public/." "$out/web/public/"
fi

{
  echo "# Vidhya changes to DeepTutor"
  echo
  echo "This build is DeepTutor $(sed -n 's/^tag=//p' "$root/upstream/deeptutor.lock") ($(sed -n 's/^repo=//p' "$root/upstream/deeptutor.lock")),"
  echo "licensed under Apache-2.0 (see LICENSE). Vidhya modified it as follows:"
  echo
  echo "- UI text rebranded in web/locales/ (brand name only)."
  for p in "${patches[@]}"; do echo "- Patch $(basename "$p")"; done
  [ -d "$root/vidhya/branding/public" ] && echo "- Brand assets replaced in web/public/."
} > "$out/NOTICE-VIDHYA.md"

echo "Assembled Vidhya app in $out (${#patches[@]} patch(es) applied)."
