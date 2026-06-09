#!/usr/bin/env bash
# Session-start dependency installer. Runs locally AND in cloud sessions.
# Uses `|| true` so one failed install never blocks the session, and skips
# work when artifacts already exist to keep startup fast.
set -uo pipefail

# Cloud-only? Uncomment to skip this entirely on your laptop:
# [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# --- Git: refresh remote refs ---
# Cloud containers are re-cloned on inactivity and can come up with STALE
# remote-tracking refs (and a checkout parked on an old commit). Fetch everything
# up front so origin/* is trustworthy; never auto-reset (that's a human/agent
# decision), just surface how far behind the checkout is.
if [ -d .git ]; then
  git fetch origin >/dev/null 2>&1 || true
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [ -n "$upstream" ]; then
    behind="$(git rev-list --count "HEAD..$upstream" 2>/dev/null || echo 0)"
    [ "${behind:-0}" -gt 0 ] && echo "NOTE: checkout is $behind commit(s) behind $upstream — consider 'git reset --hard $upstream' if the tree is clean."
  fi
fi

# --- Node ---
if [ -f package.json ] && [ ! -d node_modules ]; then
  if   [ -f pnpm-lock.yaml ]; then corepack enable >/dev/null 2>&1; pnpm install || true
  elif [ -f yarn.lock ];      then corepack enable >/dev/null 2>&1; yarn install  || true
  else npm install || true
  fi
fi

# Optional: full upstream Chromium, only if the Playwright CDN is allowlisted.
# The screenshot harness falls back to @sparticuz/chromium (delivered via npm),
# so a failure here is harmless — silenced to avoid alarming session-start logs.
if [ -f package.json ] && grep -q '"playwright"' package.json 2>/dev/null; then
  npx --yes playwright install chromium >/dev/null 2>&1 || true
fi

# --- Python ---
if [ -f pyproject.toml ]; then
  if   command -v uv >/dev/null 2>&1; then uv sync || true
  elif [ -f poetry.lock ];            then poetry install || true
  fi
elif [ -f requirements.txt ]; then
  pip install -r requirements.txt || true
fi

# --- Go ---
[ -f go.mod ]     && go mod download || true
# --- Rust ---
[ -f Cargo.toml ] && cargo fetch     || true

exit 0
