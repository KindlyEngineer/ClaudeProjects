# Project: VANTAGE

VANTAGE is a 2.5D bullet-heaven (Vampire Survivors / Megabonk lineage) built
from scratch in TypeScript + Three.js. Its differentiator: **the arena is real
tactical space** — tile-based levels of walls, cover and hazards that block
movement, projectiles and line-of-sight and funnel the horde (a more open
SYNTHETIK 2). Currently at **M3** (the build loop: 5 geometry-exploiting weapon
archetypes — gun, piercing lance, wall-arcing lobber, orbit blades, knockback
knocker — each leveled via a level-up upgrade draft of weapon/passive cards,
plus a difficulty ramp and a timed boss — on the M2 tile arenas: seeded chunk
assembly, wall collision, LOS-gated fire, hazard kill-zones, flow-field horde
pathing). A `RunConfig {seed,theme,character}` seam + `startRun()` is in place
for the future menu flow (theme = tileset). See `docs/game/` for the design
doc, architecture, and roadmap.

> Note: an earlier M2 explored a continuous-heightmap *verticality* mechanic;
> it was reassessed and replaced by the tile/geometry approach above. The name
> "VANTAGE" predates that pivot and may be revisited.

## Stack
- Language / runtime: TypeScript on Node 22 (ships to the browser)
- Package manager: npm
- Key frameworks: Three.js (WebGL rendering), Vite (build/dev), Vitest (tests),
  Playwright (headless screenshot verification)

## Layout
- `src/` — game source
  - `core/` — loop (fixed timestep + interpolation), RNG, math helpers
  - `sim/` — pure (GPU-free) game sim: SoA `World`, `Sim` systems, tile `Level`,
    `levelGen` (chunk assembly), `flowField` (horde pathing), `spatialHash`
  - `render/` — Three.js scene, camera math, billboards, `levelMesh`, textures
  - `game/` — player view, input, autopilot
  - `ui/` — DOM HUD
  - `config/` — `balance.ts` (tunables), `runConfig.ts` (theme/character seam)
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
