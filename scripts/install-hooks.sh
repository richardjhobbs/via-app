#!/usr/bin/env bash
# Installs the project's pre-commit hook into .git/hooks/pre-commit.
# Run this once after cloning the repo.
#
# Idempotent — re-running just rewrites the hook with the current shim.

set -e

# Works in both regular checkouts and git worktrees: `--git-path hooks`
# resolves to the correct hooks directory for the current working tree
# (`.git/hooks` for a normal clone, `.git/worktrees/<name>/hooks` for a
# worktree).
hooks_dir="$(git rev-parse --git-path hooks)"
mkdir -p "$hooks_dir"
hook="$hooks_dir/pre-commit"

cat > "$hook" <<'EOF'
#!/usr/bin/env bash
# Auto-installed by scripts/install-hooks.sh
node "$(git rev-parse --show-toplevel)/scripts/precommit-check.mjs"
EOF

chmod +x "$hook"

echo "Installed pre-commit hook at $hook"
echo "It calls scripts/precommit-check.mjs (em-dash + tsc --noEmit checks)."
echo "Bypass for emergencies only: git commit --no-verify"
