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
- The screenshot harness needs Playwright's Chromium, whose CDN
  (`cdn.playwright.dev`) is NOT in the default network allowlist. Under a
  restrictive **Custom** policy it 403s; allowlist that host (see
  `docs/cloud-environment.md`) to enable in-session screenshots. Without it,
  verification falls back to `typecheck → test → build` (still meaningful — the
  sim spine is unit-tested without a GPU).
- `gh` CLI is NOT pre-installed; the environment setup script installs it (see
  `docs/cloud-environment.md`).
- No secrets store exists — anything sensitive goes in environment variables
  (visible to anyone who can edit the environment).
