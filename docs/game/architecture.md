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
    dice.ts       seeded + logged rolls                                      ✅
    combat.ts     uniform model: facing armour + structure + 4-state crits   ✅
    logistics.ts  finite ammo/fuel, resupply, supply-line tracing, dry-out   ✅
    turn.ts       phased initiative (recon→fires→maneuver + reserve)         ✅
    actions.ts    shared action API (move/fire/resupply), forward-observer   ✅
    vision.ts     per-side vision gating                                     ✅
    pathing.ts    Dijkstra reachability for the AI                           ✅
    commander.ts  inspectable utility AI for the mechs + intent string       ✅
    objective.ts  Seize evaluation + win/loss                                ✅
    match.ts      headless match runner + support policies (self-play seam)  ✅
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
- **Slice 2 — Uniform combat model** ✅
  One model for every unit (`sim/combat.ts`): to-hit (cover + attacker-
  suppression mods) → facing-armour penetration (`pen ≥ arc armour`) → structure
  damage → a possible crit from the shared 4-state table (`data/crits.ts`:
  mobility / weapon / sensors / shaken) → suppression that breaks the crew into
  "shaken". All randomness flows through a seeded, logged dice (`sim/dice.ts`,
  `mulberry32Step` over `GameState.rngState`), so attacks are deterministic and
  every roll is auditable. Crit effects exposed as `canMove`/`canFire`/
  `effectiveVision` for later slices. Tuning in `data/rules.ts`. Verified: 10
  unit tests (facing arcs, front-bounces/rear-penetrates end-to-end, ammo use,
  determinism + roll-logging, suppression break, range/cover) — 27 total.
- **Slice 3 — Turns, actions & logistics** ✅
  Phased initiative recon→fires→maneuver with a reserve (`sim/turn.ts`: home
  phase by class, `beginTurn` upkeep — supply recompute, suppression decay,
  shaken recovery). The shared player-action API (`sim/actions.ts`:
  `moveUnit`/`attackUnit`/`resupplyUnit` — one move + one main action per unit
  per turn) that the UI, scripted scenarios and the AIs all drive. Tactical
  logistics (`sim/logistics.ts`): finite ammo + fuel/MP, adjacent resupply from
  a finite budget, and supply-line tracing (BFS from a side's home edge +
  forward supply units; enemies/impassable terrain cut the line) with dry-out
  penalties (halved MP, then no fire). Verified: 20 unit tests (phase order &
  eligibility, reserve, upkeep; move/fire/resupply validation incl. move-then-
  fire; supply cut by terrain & by enemies, forward-depot projection, dry-out,
  non-negative-supply invariant, phased run terminates within the turn cap) —
  47 total — plus a deterministic scripted skirmish on the real map (headless
  dump: 35 logged rolls, a unit destroyed, a mech mobility-killed & stranded,
  suppression climbing) and a board screenshot with health/supply status badges.
- **Slice 4 — Vision + mech commander AI** ✅
  Per-side vision (`sim/vision.ts`: sight range, sensors-crit-halved, terrain-LOS
  gated — "no recon → blind"). The inspectable utility commander
  (`sim/commander.ts`): for each mech it scores every reachable hex
  (`sim/pathing.ts` Dijkstra) by a transparent weighted sum and takes the best,
  then fires. Every term is a player lever — objective pull, supply pull × a
  sustainment **need** (resupply eases it), exposure (FIRES suppress enemies,
  cover/screening lower it), a fog-caution penalty for unscouted hexes (RECON
  removes it), and an attack pull toward degraded enemies. Deterministic (no
  RNG), pure `decideMech()` returns the action + a human-readable **intent**
  (surfaced on-board and in the HUD). Verified: 10 unit tests (LOS/visibility,
  sustainment need, advance vs break-contact-to-resupply, immobilised-holds,
  the exposure levers — suppression/cover/vision-gating, target vision-gating,
  determinism) — 57 total — plus a screenshot of commander-driven mechs showing
  their live intents ("Advancing on the objective" / "Immobilised — holding").
- **Slice 5 — Objective + the core proof** ✅ **— hypothesis PROVEN**
  Seize evaluation + win/loss (`sim/objective.ts`: attacker takes the zone by the
  turn limit; loses on the clock, all-mechs-lost, or all-support-lost). A
  vision-gated **forward-observer rule** (you can't engage — even with indirect
  fire — what your side can't see) makes recon load-bearing, and a **shaken**
  crew now can't fire (so suppressive fire actually shields an advance). The
  match runner (`sim/match.ts`) plays a whole battle headless, with each side's
  support supplied as a policy; the player plan is recon-scout + artillery-
  suppress + supply-resupply + screen. **The core proof** (`test/coreproof.test.ts`,
  fixed seed): unsupported, the mechs run dry and are stopped short → **RED holds
  0/12 seeds**; with the same seed + the support plan → **BLUE seizes (≥9/12,
  18/20 broadly)** — the delta attributable to player action alone. Deterministic,
  always terminates, supply never negative. Verified: 9 unit tests (5 objective +
  4 proof) — **66 total** — and two screenshots: the unsupported failure (mech
  stranded "low fuel", RED HELD) vs the supported success (BLUE SEIZED in 9 turns).

> **v0 is complete.** All five brief §4 acceptance criteria are met: the
> falsifiable core proof (criterion 1) holds, the sim is deterministic, no
> invariant is violated and every match terminates, the commander exposes a
> human-readable intent each turn, and the harness runs headless + captures
> board screenshots.
- **Slice 6 — Interactive UI**
  Minimal click-to-act layer feeding the same action API.

## AI milestone (the v1 core — sound, role-aware, fog-limited)

Per the owner: the AI must (a) never behave tactically/logically unsoundly for
either side, and (b) command *any* unit assigned to it (set per-unit in scenario
data via `controller`), understanding each role's capabilities and limits. It
plans coordinated + adaptive — but only on what it KNOWS (current sight + decayed
memory), never ground truth. Staged, gated:

- **AI-1 — Fog-limited knowledge + controller model** ✅
  Per-side **belief** (`sim/knowledge.ts`): `updateBelief` each turn records
  visible enemies as fresh sightings and remembers the rest at their last-known
  hex, forgetting them after `memoryTurns`. The commander now positions on
  *belief* (cautious around remembered threats) and fires only on what's *visibly*
  there. A `controller` ("ai"/"player") is set per unit in scenario data
  (`data/maps`); v0 keeps the brief's split (blue mech AI, blue support player,
  red all AI). Verified: 4 belief/controller tests (70 total); the core proof
  still holds (0/20 unaided, 16/20 with support).
- **AI-2 — Role-aware force AI** *(next)*
  Generalize `commandMechs` → `commandForce(side)` driving every `ai` unit by
  role: recon scouts/keeps standoff, artillery suppresses from range, armour
  seeks flanks, infantry holds cover, supply sustains, mech spearheads — with
  capability/limitation soundness (penetration-aware targeting → no futile shots;
  correct standoff; crit/ammo/fuel/supply awareness; hazard avoidance). Rewire
  the match to controller-based; retire the scripted red policy. Soundness
  encoded as self-play invariants.
- **AI-3 — Coordinated + adaptive planning**
  A per-turn force plan from the belief — axis selection, role tasking, target
  deconfliction, mutual support — adapting to *known* enemy posture. Bulk
  self-play for balance/soundness.

Then the rest of v1 (Breakthrough objective, more units/maps in data) per brief §5.

## Verification loop
Per change: `typecheck → vitest → build → screenshot / headless run`. From the
AI slices on, headless AI-vs-AI self-play is the primary balance, termination,
crash and invariant harness.
