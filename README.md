# Claude Code on the Web — Project Repo

This repository is pre-configured for **Claude Code on the web** (claude.ai/code).
Everything Claude needs at session start is committed here, because cloud sessions
start from a fresh clone — nothing from your local `~/.claude` carries over.

## What's wired up

| Path | Purpose | Carries to cloud? |
|------|---------|-------------------|
| `CLAUDE.md` | Project context & instructions Claude reads every session | Yes |
| `.claude/settings.json` | SessionStart hook (runs dependency install) | Yes |
| `.mcp.json` | Project-scope MCP servers | Yes |
| `.claude/rules/` | Always-on rules | Yes |
| `.claude/commands/` | Custom slash commands | Yes |
| `scripts/install_deps.sh` | Multi-stack dependency installer, called by the hook | Yes |
| `docs/cloud-environment.md` | GUI-side config (setup script, network, env vars) — paste into the web UI, since these live on the *environment*, not the repo | N/A |

## Push it to GitHub

Create an empty repo on GitHub (no README/.gitignore — this repo already has both), then:

```bash
git remote add origin git@github.com:<you>/<repo>.git   # or https://...
git push -u origin main
```

## Connect it to the web harness

1. Ensure your GitHub auth grant covers this repo (App -> "All repositories", or `gh auth refresh -s repo` then `/web-setup`).
2. Go to claude.ai/code, pick the repo, configure the environment using `docs/cloud-environment.md`.
3. Or from terminal: `claude --remote "..."` (push first — the VM clones from GitHub, not your disk).

Docs: https://code.claude.com/docs/en/claude-code-on-the-web
