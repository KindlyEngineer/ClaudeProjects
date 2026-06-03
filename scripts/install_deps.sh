#!/usr/bin/env bash
# Session-start dependency installer. Runs locally AND in cloud sessions.
# Uses `|| true` so one failed install never blocks the session, and skips
# work when artifacts already exist to keep startup fast.
set -uo pipefail

# Cloud-only? Uncomment to skip this entirely on your laptop:
# [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# --- Node ---
if [ -f package.json ] && [ ! -d node_modules ]; then
  if   [ -f pnpm-lock.yaml ]; then corepack enable >/dev/null 2>&1; pnpm install || true
  elif [ -f yarn.lock ];      then corepack enable >/dev/null 2>&1; yarn install  || true
  else npm install || true
  fi
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
