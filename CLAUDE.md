# Project: VANTAGE

VANTAGE is a 2.5D bullet-heaven (Vampire Survivors / Megabonk lineage) built
from scratch in TypeScript + Three.js. Its differentiator: **the ground isn't
flat** — elevation and terrain are first-class mechanics (high-ground combat,
ledges/pits as kill-zones, terrain-aware enemy pathing). Currently at **M0**
(playable scaffold: tilted 3D view + controllable capsule). See `docs/game/`
for the full design doc, architecture, and milestone roadmap (M0–M5).

## Stack
- Language / runtime: TypeScript on Node 22 (ships to the browser)
- Package manager: npm
- Key frameworks: Three.js (WebGL rendering), Vite (build/dev), Vitest (tests),
  Playwright (headless screenshot verification)

## Layout
- `src/` — game source
  - `core/` — loop (fixed timestep + interpolation), RNG, math helpers
  - `render/` — Three.js scene, camera math
  - `game/` — player, input (ECS lands in M1)
  - `config/` — `balance.ts`, all tunable numbers in one place
- `test/` — Vitest unit tests for pure sim logic (run headlessly, no GPU)
- `tools/` — `screenshot.ts` self-verification harness
- `scripts/` — automation, including the session-start dependency installer
- `docs/game/` — `design.md` and `architecture.md`

## Conventions
- Keep sim logic pure and GPU-free where possible so it stays Vitest-testable.
- Data-oriented hot path (typed arrays / SoA), no per-frame allocations.
- All balance constants go in `src/config/balance.ts`, not inline.
- Run the full test suite before declaring a task done: `npm test`
- Typecheck before committing: `npm run typecheck`

## Build & test
- Install deps: handled automatically at session start by `scripts/install_deps.sh`
- Typecheck: `npm run typecheck`
- Test: `npm test`
- Build: `npm run build`
- Run locally: `npm run dev` (open the printed localhost URL; WASD/arrows to move)
- Screenshot-verify: `npm run screenshot` → `tools/shots/latest.png`

## Notes for cloud sessions
- Screenshot self-verification works **regardless of network policy**. The
  harness (`npm run screenshot` → `tools/shots/latest.png`) prefers a standard
  Playwright/system Chromium, but falls back to `@sparticuz/chromium` — a
  Chromium delivered through the npm registry — so it needs no access to the
  often-blocked Playwright CDN (`cdn.playwright.dev`). Allowlisting that CDN
  (see `docs/cloud-environment.md`) is optional and just swaps in the full
  upstream Chromium.
- `gh` CLI is NOT pre-installed; the environment setup script installs it (see
  `docs/cloud-environment.md`).
- No secrets store exists — anything sensitive goes in environment variables
  (visible to anyone who can edit the environment).
