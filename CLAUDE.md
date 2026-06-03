# Project: <NAME>

<One-paragraph description of what this project is and its current state.>

## Stack
- Language / runtime: <e.g. Python 3.12 / Node 22>
- Package manager: <uv / pnpm / cargo / ...>
- Key frameworks: <...>

## Layout
- `src/` — <...>
- `tests/` — <...>
- `scripts/` — automation, including the session-start dependency installer

## Conventions
- <Coding standards, formatting, naming>
- Run the full test suite before declaring a task done: `<test command>`
- Lint/format: `<command>`

## Build & test
- Install deps: handled automatically at session start by `scripts/install_deps.sh`
- Build: `<command>`
- Test: `<command>`
- Run locally: `<command>`

## Notes for cloud sessions
- Postgres/Redis are pre-installed but not running — ask Claude to `service postgresql start` if needed.
- `gh` CLI is NOT pre-installed; the environment setup script installs it (see docs/cloud-environment.md).
- No secrets store exists — anything sensitive goes in environment variables (visible to anyone who can edit the environment).
