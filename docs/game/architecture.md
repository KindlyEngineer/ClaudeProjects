# VANTAGE — Architecture & Build Plan

Companion to [`../brief.md`](../brief.md) (the spec). This is the engineering
plan: stack, module map, the v0 slice roadmap, and the verification loop.

## Stack
TypeScript + Three.js (2.5D WebGL) + Vite, tested with Vitest, screenshot-
verified with Playwright (Chromium, `@sparticuz/chromium` fallback). Minimal
dependencies by design — nothing that risks derailing autonomous setup.

## Core principle
**A pure-function deterministic sim, fully separated from rendering.** The sim
advances `GameState` via pure functions; the renderer only reads state. This is
what makes mechanics unit-testable and AI-vs-AI self-play possible. All
randomness is seeded and every roll is logged (`GameState.rollLog`).

## Module map
```
src/
  core/   rng.ts (seeded mulberry32) · math.ts
  sim/    (pure, no THREE)
    hex.ts        coords, distance, line, facing → front/side/rear arcs   ✅
    state.ts      GameState, unit instances, createGame()                 ✅
    combat.ts     uniform model: facing armour + structure + 4-state crits  (slice 2)
    logistics.ts  finite ammo/fuel, resupply, supply-line tracing, dry-out  (slice 3)
    turn.ts       phased initiative (recon→fires→maneuver + reserve)         (slice 3)
    actions.ts    shared player-action API (move/fire/resupply/recon)        (slice 3)
    vision.ts     per-side vision gating                                     (slice 4)
    commander.ts  inspectable utility AI for the mechs + intent string       (slice 4)
    enabler.ts    AI that plays the support role (enemy + self-play)         (v1)
  data/   types.ts (schemas) · terrain.ts · units.ts · maps/                 ✅
  render/ view.ts (scene/camera) · board.ts (heightmap + grid + markers)     ✅
  main.ts boot                                                               ✅
```
Content (`data/`) is tables: add a row to add a unit/terrain/map.

## v0 slice roadmap
Each slice ends testable and screenshot/headless-verified; gate between slices.

- **Slice 1 — Foundation & board** ✅
  Hex geometry + tests, data schemas, one handcrafted map (terrain + elevation),
  `GameState`, and the 2.5D heightmap render (continuous surface, hex grid,
  facing-aware unit markers, objective zone). Verified: 17 unit tests + a board
  screenshot showing both forces, facings, terrain and the seize zone.
- **Slice 2 — Uniform combat model**
  Facing armour + structure + 4-state crit table + suppression, data-driven,
  seeded rolls with full roll-logging. Unit-tested in isolation.
- **Slice 3 — Turns, actions & logistics**
  Phased initiative + reserve; the shared player-action API; finite ammo +
  fuel/MP; adjacent resupply; supply-line tracing with dry-out penalties.
  Invariant tests (supply never negative; matches terminate).
- **Slice 4 — Vision + mech commander AI**
  Vision gating; the inspectable utility commander reading v0's inputs; the
  per-turn intent string. Decision unit-tests (state → action).
- **Slice 5 — Objective + the core proof**
  Seize evaluation + win/loss; the falsifiable criterion-1 scenario (same seed
  fails without support, succeeds with it). **Gate: the hypothesis.**
- **Slice 6 — Interactive UI**
  Minimal click-to-act layer feeding the same action API.

Then v1 (full mirror, enabler AI, Breakthrough, bulk self-play) per brief §5.

## Verification loop
Per change: `typecheck → vitest → build → screenshot / headless run`. From the
AI slices on, headless AI-vs-AI self-play is the primary balance, termination,
crash and invariant harness.
