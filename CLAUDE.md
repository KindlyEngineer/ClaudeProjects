# Project: VANTAGE

VANTAGE is a turn-based, hex-based **combined-arms tactics** game built from
scratch in TypeScript + Three.js (2.5D, continuous heightmap render). Its one
unusual premise: **the player commands the supporting effort and the supply
line, never the main effort.** The heaviest units — the mechs — are run by an
autonomous, *legible*, objective-seeking utility-AI commander. The player never
orders the mechs; they win or lose by *enabling* that autonomous main effort —
feeding it supply, vision and fire support, and shaping the battlefield the
commander reasons over.

**The hypothesis the first slice must prove:** a player controlling only support
and logistics can meaningfully and legibly change the outcome of a battle fought
by an autonomous main effort.

> **`docs/brief.md` is the design source of truth.** Do not deviate from its
> locked decisions without flagging. Resolved with the owner: loss = mission
> failure OR all mechs destroyed OR all support units lost; v0 ships an
> interactive UI *and* a headless harness; the heightmap is **visual** in v0
> (sim cover/exposure comes from terrain *type*), elevation turns mechanical in v1.

> History: this repo previously held a 2.5D bullet-heaven also called "VANTAGE";
> it was scrapped. Only the 2.5D + heightmap presentation and the self-
> verification harness carried over. Git history retains the old build.

## Stack
- Language / runtime: TypeScript on Node 22 (ships to the browser)
- Package manager: npm
- Frameworks: Three.js (2.5D WebGL render), Vite (build/dev), Vitest (tests),
  Playwright (headless screenshot verification). Minimal dependencies by design.

## Layout
- `src/`
  - `core/` — `rng.ts` (seeded mulberry32), `math.ts`
  - `sim/` — pure deterministic simulation (no THREE):
    - `hex.ts` — geometry: coords, distance, line, facing → armour arcs
    - `state.ts` — `GameState`, unit instances, `createGame()`; status helpers
    - `dice.ts` — seeded, logged rolls (`GameState.rngState` + `rollLog`)
    - `combat.ts` — the one uniform model: facing armour → structure → crits + suppression
    - `turn.ts` — phased initiative (recon→fires→maneuver + reserve) + upkeep
    - `actions.ts` — shared action API: move / fire / resupply (UI + AI + scenarios)
    - `logistics.ts` — finite ammo/fuel, resupply, supply-line tracing + dry-out
    - `vision.ts` — per-side sight (LOS-gated); forward-observer targeting
    - `pathing.ts` — Dijkstra reachability for the AI
    - `commander.ts` — the inspectable utility AI for the mechs + intent string
    - `objective.ts` — Seize evaluation + win/loss
    - `match.ts` — headless match runner + support policies (self-play seam)
    - `aiutil.ts` — shared scripted-unit helpers · `demo.ts` — capture skirmish
  - `data/` — all content as data tables: `types.ts` (schemas), `terrain.ts`,
    `units.ts`, `maps/` (handcrafted maps). Add a row to add content.
  - `render/` — reads sim state only: `view.ts` (scene/camera), `board.ts`
    (heightmap terrain + hex grid + facing-aware unit markers)
  - `main.ts` — boot
- `test/` — Vitest unit tests (pure logic, no GPU)
- `tools/screenshot.ts` — Playwright board-state capture
- `docs/` — `brief.md` (source of truth), `game/` (design + architecture),
  `cloud-environment.md`

## Architecture rules (from the brief)
- **Pure-function deterministic sim, fully separate from render.** Render only
  reads state. This is what makes mechanics unit-testable and self-play possible.
- **Seed all randomness; log every roll** (`GameState.rollLog`) for the harness.
- **Data-driven content** — units, weapons, crit tables, objectives, maps are
  data, not code branches.
- **The mech commander + AI enabler are reusable modules**, shared by the
  player-side AI, the enemy, and AI-vs-AI self-play.
- **One uniform combat model for every unit** (facing armour + structure + a
  shared 4-state crit table + suppression). No bespoke per-unit systems. No heat.
- **Programmer art only.** No real assets, audio, or animation.

## Build & test
- Install deps: handled at session start by `scripts/install_deps.sh`
- Typecheck: `npm run typecheck`
- Test: `npm test` (run the full suite before declaring a task done)
- Build: `npm run build`
- Run locally: `npm run dev`
- Screenshot-verify: `npm run screenshot` → `tools/shots/latest.png`, or
  `npx tsx tools/screenshot.ts "name=?seed=N"`

## Verification workflow
Build in vertical slices; self-verify at each commit (typecheck → vitest →
build → screenshot/headless run). Run autonomously within a slice; gate between
slices. Headless AI-vs-AI self-play is the primary balance/termination harness
(arrives with the AI slices).

## Notes for cloud sessions
- Screenshot self-verification works regardless of network policy: the harness
  prefers system/Playwright Chromium but falls back to `@sparticuz/chromium`
  (npm-delivered), so it needs no access to the Playwright CDN.
- No secrets store — anything sensitive goes in environment variables.
