#!/usr/bin/env bash
# One-time per clone: blocks commits that edit upstream/deeptutor/ by hand.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
hook="$root/.git/hooks/pre-commit"
cat > "$hook" <<'H'
#!/usr/bin/env bash
exec "$(git rev-parse --show-toplevel)/scripts/upstream/check-pristine.sh" --staged
H
chmod +x "$hook"
echo "Installed pre-commit guard: $hook"
