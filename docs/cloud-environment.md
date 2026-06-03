# Cloud environment config (paste into the web UI)

The repo files cover what Claude reads. These settings live on the **environment**
in the web UI (claude.ai/code -> environment selector -> Add/Edit environment),
not in the repo, so they're documented here for reference.

## Network access
Default to **Trusted** (package registries + GitHub + cloud SDKs). Switch to
**Custom** and add an allowlist only if you need a host that isn't already covered.
Use **None** for confidential review with no outbound traffic.

### Headless browser for the screenshot harness
The game's self-verification harness (`tools/screenshot.ts`) drives a headless
Chromium, downloaded by Playwright. Its CDN is **not** part of the default
allowlist, so under a restrictive **Custom** policy the install fails with
`403 Host not in allowlist`. To enable in-session screenshots, add these hosts
to the **Custom** allowlist (or use **Trusted** if it already covers them):

```
cdn.playwright.dev                      # Playwright browser binaries (primary)
playwright.download.prss.microsoft.com  # Microsoft mirror (fallback)
```

Once allowed, the browser is fetched by either the SessionStart hook
(`scripts/install_deps.sh`) or — preferably, for caching — the setup script
below. To pin a custom mirror, set `PLAYWRIGHT_DOWNLOAD_HOST` (honored by the
install step). Verify with `npm run screenshot` (writes `tools/shots/latest.png`).

## Setup script
Runs once as root before Claude launches; result is cached (~7 days) so installs
persist across sessions. Keep it under ~5 minutes. The `gh` CLI is NOT pre-installed,
so add it here if you want commands the built-in GitHub tools don't cover:

```bash
#!/bin/bash
apt update && apt install -y gh || true

# Pre-provision the headless browser for the screenshot harness (cached ~7 days).
# Requires the Playwright CDN to be allowlisted (see Network access above).
if [ -f package.json ]; then
  npm install || true
  npx --yes playwright install --with-deps chromium || true
fi
```

(Pair this with a `GH_TOKEN` env var below — `gh` reads it automatically, no `gh auth login` needed.)

## Environment variables  (.env format, one KEY=value per line, NO quotes)
There is no secrets store. These are visible to anyone who can edit the environment.

```
NODE_ENV=development
# GH_TOKEN=ghp_xxx          # only if your setup script installs gh
# CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=70   # compact earlier than the ~95% default
```

## Distinction to remember
- **Setup script** (here, GUI): things the cloud lacks but your laptop has — runtimes, CLI tools. Cached.
- **SessionStart hook** (in repo, `.claude/settings.json` -> `scripts/install_deps.sh`): project setup that should run everywhere, local and cloud. Not cached; runs every session.
