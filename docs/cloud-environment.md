# Cloud environment config (paste into the web UI)

The repo files cover what Claude reads. These settings live on the **environment**
in the web UI (claude.ai/code -> environment selector -> Add/Edit environment),
not in the repo, so they're documented here for reference.

## Network access
Default to **Trusted** (package registries + GitHub + cloud SDKs). Switch to
**Custom** and add an allowlist only if you need a host that isn't already covered.
Use **None** for confidential review with no outbound traffic.

### Headless browser for the screenshot harness
The game's self-verification harness (`tools/screenshot.ts`) needs a headless
Chromium. **No environment change is required:** it falls back to
`@sparticuz/chromium`, a Chromium build delivered through the **npm registry**
(already allowlisted), so screenshots work even under a restrictive **Custom**
policy. Just run `npm run screenshot` → `tools/shots/latest.png`.

Optionally, to use the **full upstream Chromium** (e.g. exact-pixel parity with
Playwright's bundled build) instead of the npm fallback, allowlist its CDN —
under **Custom**, add (or use **Trusted** if it already covers them):

```
cdn.playwright.dev                      # Playwright browser binaries (primary)
playwright.download.prss.microsoft.com  # Microsoft mirror (fallback)
```

Then `npx playwright install chromium` (the SessionStart hook / setup script
below already attempts this; it no-ops harmlessly when the CDN is blocked).
`PLAYWRIGHT_DOWNLOAD_HOST` can pin a custom mirror.

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
