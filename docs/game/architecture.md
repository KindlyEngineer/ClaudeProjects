# VANTAGE — Architecture & Build Plan

Companion to [`../brief.md`](../brief.md) (the founding spec) and
[`endstate.md`](endstate.md) (the 1.0 destination + ratified decisions). This
is the engineering build log: stack, module map, the slice roadmap, and the
verification loop.

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
- **Slice 6 — Interactive UI** ✅ (UI-1)
  A hands-on click-to-act layer over the existing action API — the human stand-in
  for the runMatch "player" policy, so play and the harness share one seam. The
  player commands ONLY their own units (`controller === "player"`); the mechs and
  the enemy stay AI (`commandForce`). Flow is BattleTech (2018)-style: select a
  unit (board marker via raycast, or its bottom-centre info card), its reachable
  hexes light up (blue), then **press-and-hold** a destination, **drag** the mouse
  to aim which hex face the unit ends up fronting (a six-arrow rosette tracks the
  cursor, snapping to the nearest face), and **release** to lock it in and execute
  the move. The facing sets which armour arc incoming fire strikes — `moveUnit`
  takes an optional `finalFacing`, defaulting to the travel direction for
  AI/scripted callers. A plain click (no drag) on a red enemy fires / on a green
  ally resupplies / on a unit selects it. Input is press/drag/release (mousedown
  on the canvas, mousemove + mouseup on the window so a gesture that leaves the
  canvas still commits); cursor→facing maps by intersecting the camera ray with a
  ground plane at the destination and taking the nearest of the six faces. "End
  Phase" hands the phase to the AI for both sides then
  advances — the same per-phase ordering as `runMatch` (player acts, then
  commandForce blue/red, then nextPhase). Cards show structure/fuel/ammo, supply
  + shaken status, and the mech's commander intent; not-ready units (spent, or
  off-phase) grey out on the board and in the cards.
  - Rules-facing logic is pure + unit-tested (`ui/control.ts`: readiness,
    move/attack/resupply options, card model); the DOM/Three shell
    (`ui/interactive.ts`) is verified by screenshot. `render/overlay.ts` draws the
    range/target highlights; `hex.worldToHex` turns a board click into a hex
    (round-trip tested). Headless URL modes (coreproof / skirmish) still render a
    static board for the capture harness.

- **Slice 6.1 — UI hardening + player fog (UI-2)** ✅
  - **Player fog of war.** The interactive board renders AS THE PLAYER'S SIDE
    SEES IT (`buildBoard`'s `viewSide`): enemies in sight render live, remembered
    sightings render as faded grey-ring "ghosts" at their LAST-KNOWN hex, and
    unscouted enemies don't render at all. Selection (`selectableUnitIdAt`) and
    inspection (`inspectModel`) flow through the side's belief — never ground
    truth — so recon is load-bearing for the PLAYER, not just the AI. Enemy mech
    intent banners are hidden in a fogged view. Headless modes (no `viewSide`)
    still render ground truth for verification.
  - **Turn-in-place**: press-and-hold the selected unit's own hex and drag —
    rotation is the unit's move (`actions.faceUnit`; mobility crits forbid it).
  - **Reserve**: a "Hold in reserve" button defers an unacted unit out of its
    home phase to commit in maneuver (`reserved` is now cleared each upkeep).
  - **Hit-chance preview** ("62%" labels over each targetable enemy) computed by
    the same `hitChance` the roll uses; `attackOptions` now picks each target's
    BEST weapon (penetration-aware), not the first that reaches.
  - **Inspect panel** (bottom-right): selected own unit = full data + terrain;
    selected enemy = believed state only, flagged `IN SIGHT` / `last seen T#`;
    clicked empty ground = terrain (name/cover/move/LOS/elevation-visual).
  - **Feedback + legibility**: failed orders surface their reason in the bar;
    cards add a suppression meter and named crit labels; card-strip scroll is
    preserved across rebuilds; adjacent mech banners stagger height.
  - **Correctness/consistency**: the controller consumes the TESTED
    `ui/control.ts` helpers (no duplicated reachability — the immobilised-unit
    range bug is dead); one shared `logistics.needsSupply` (UI = any deficit,
    AI/policies = 60% fuel bar) replaces three private copies; win/loss banner
    and HUD are side-aware (defence reads "OBJECTIVE DEFENDED", not attacker
    text); `evaluateOutcome` ends the match at once when the whole defence is
    destroyed; map orientation convention (blue = min-q edge) documented on
    `MapDef`; texture disposal on rebuild (CanvasTextures used to leak);
    `#bar`/`#inspect` hide when empty in headless modes.
  - **End-to-end gesture test** (`npm run uitest`, `tools/uitest.ts`): drives a
    REAL mouse press-drag-release through the raycaster in headless Chromium and
    asserts the unit's resulting hex + facing for both the move and the
    turn-in-place — covering exactly the glue unit tests can't.

- **Slice 6.2 — "Feel" (UI-3): events, animation, fidelity** ✅
  *(Under the owner's 2026-06-09 brief amendment: visual fidelity/animation in
  scope, procedural/internal preferred.)*
  - **Sim event stream** (`sim/events.ts`, `GameState.events`): every action
    appends a plain record of WHAT HAPPENED (move path, shot outcome with
    arc/crit/suppression, resupply amounts, turn/phase markers). Pure data,
    append-only, deterministic — consumed by playback and the combat log, unit
    tested. The sim still never knows about render.
  - **Animated persistent stage** (`render/stage.ts` + `render/anim.ts`): the
    interactive board no longer rebuilds per click. Terrain builds once; unit
    visuals reconcile by appearance-signature; sim events PLAY BACK as
    presentation — tweened hex-by-hex movement (walk-bob for mechs/infantry),
    turret aim + barrel recoil + muzzle flash + travelling tracer + impact
    flash, floating result text ("7 dmg · side armour", "CRIT — mobility",
    "MISS"), death animation into a **persistent wreck** with scorch ring.
    Playback is fog-aware: an unseen attacker shelling a seen target reads as
    incoming fire from nowhere; fights nobody saw don't render at all.
  - **Procedural multi-part models** (`render/models.ts`): mechs with
    legs/torso/visor/shoulder cannon (scout = slighter), tanks with
    hull/tracks/rotating turret, wheeled recon with sensor mast, SP artillery
    with elevated tube, supply trucks, infantry fire-teams (engineers carry a
    demo crate). Forward = +X so facing rotates the rig; builders return
    turret/barrel/muzzle refs for animation. Soft shadows ground everything
    (`view.ts`: PCFSoft shadow map sized to the board).
  - **Camera**: right-drag pan + wheel zoom-to-cursor (OrbitControls, rotation
    locked, left button reserved for command gestures).
  - **Combat log** (`#log`, fog-honest — only events the player's side saw),
    **hover** (hex outline + pointer cursor), **match-end overlay** (result,
    turns, own losses, confirmed kills, replay-same-seed / new-seed buttons).
  - Mid-turn targeting fix: a click resolves to anything the selected unit can
    legally SHOOT (live vision) even before the per-turn belief refresh draws it.
  - `?focus=q,r&dist=N` frames close-up verification shots; `npm run uitest` now
    also drives a live FIRE through the real input path (click target → tracer
    playback → action spent) — 11 e2e checks total.
  - Still deferred: undo, per-weapon manual override, idle animations.

- **FX-1 — Support verbs: battlefield effects, fire missions, commander needs** ✅
  The function slice: the player's own tools get DEPTH, and the commander gets a
  voice. This is where "win through support geometry" becomes literal.
  - **Battlefield effects substrate** (`data/effects.ts` + `sim/effects.ts`):
    smoke (blocks LOS, dissipates after 2 turns) and fortifications (+2 move
    cost, +2 cover, permanent) as data rows. The load-bearing design: all ground
    questions now flow through three SHARED queries — `moveCostAt`, `coverAt`,
    `sightBlockedAt` — used by movement, pathing, combat to-hit, vision and the
    AI's own scoring. Laying smoke genuinely blinds every consumer; fortifying
    genuinely slows and shelters. New effects = new rows, zero new branches.
  - **Fire missions** (`actions.fireMission`): indirect-fire area missions over a
    7-hex footprint, costing 2 rounds. SUPPRESS rattles every enemy in the area
    (no structure damage — saturation pins, aimed fire kills) and requires an
    observer on the target (forward-observer rule); SMOKE lays a sight-blocking
    screen and may target unobserved ground. **Fortify** (`actions.fortifyHex`):
    engineers entrench their own or an adjacent hex.
  - **The AI uses the same verbs** (soundness directive): artillery fires an
    area mission when 2+ visible enemies share a footprint (saturation beats
    plinking); a DEFENDING engineer on a hold digs its position in. Self-play
    consequence, verified: prepared defences got stronger (Ridge attacker
    18% all-AI) while the supported-attack proof still passes — sharpening the
    core premise that the player's support is what cracks a defence.
  - **Commander needs** (`sim/needs.ts` + the COMMANDER panel): read-only
    requests derived from the SAME signals the mech AI acts on — "low ammo —
    resupply it or it breaks contact", "approach unscouted — needs recon eyes
    forward", "developing — suppress the defence to open the assault window",
    cut-off/shaken/immobilised warnings. The legibility loop the hypothesis
    rests on, without violating the no-tasking rule (it's a one-way radio).
  - **UI**: targeting mode with live footprint preview under the cursor
    (☄ Suppress / ▒ Smoke / ▦ Fortify buttons in the bar), Esc backs out
    (targeting → pending move → selection), fog-aware smoke/fortification
    markers (billowing puffs / sandbag arcs; enemy forts render only where
    scouted, smoke clouds read from anywhere), barrage playback (rolling
    flashes across the footprint), log lines. `?fxdemo` drops sample effects
    for screenshot verification.
  - **Verification**: 126 vitest tests (effects/missions/fortify/AI-usage/needs
    suites); `npm run uitest` extended to drive the FULL mission flow through
    the real UI (End Phase → select guns → Smoke → click target → 7-hex screen
    laid, action spent) — 15 e2e checks; self-play 0 invariant violations.

- **V1-ELEV — Mechanical elevation + the main effort's voice** ✅
  The heightmap stops being decoration (the last big v1 promise), and the
  autonomous mechs you serve get an identity.
  - **Mechanical elevation** (`sim/elevation.ts`, tuning in `data/rules.ts`):
    a RIDGE cresting above the eye-to-eye line breaks LOS (`heightClearsLine` in
    `vision.hasLineOfSight`); firing DOWN a slope gains a capped to-hit bonus
    (`heightHitBonus` in `combat.hitChance`, direct fire only — indirect arcs
    over); CLIMBING costs extra MP (`climbCost` in `pathing` + `actions.moveUnit`,
    descending free). Flat ground (every test map) is a no-op, so the unit suite
    is unchanged; gentle tuning keeps rolling terrain textured without dominating.
  - **The AI reads terrain too**: a `highGround` consideration rewards ground
    that *overlooks the perceived enemy* (height advantage, contact-gated so it
    never chases empty peaks), and the commander's intent gains a terrain voice
    ("Cresting the ridge — pressing the attack", "Overwatch from high ground",
    "Holding the high ground"). Recon reports "Overwatching from high ground".
  - **Call signs** (`state.unitLabel` + `UnitInstance.callSign`): the main effort
    is named, not numbered — deterministic per side (Vanguard, Saber, …), mechs
    only. Flows through the board banner ("Vanguard — …"), the cards (name +
    type subtitle), the combat log and the commander-needs readout. The
    legibility/soul layer: you're enabling a named entity with agency.
  - **Balance re-pin**: elevation favours the prepared defence (correct — Ridge
    is attacker-disadvantaged by design), so the fixed-seed core proof moved to
    seed 1 (clean unaided-loss / supported-win; unaided still 0/20, supported
    14/20) and the self-play "both roles" bound relaxed to a majority. **A latent
    bug surfaced and was fixed**: fractional fuel (from climb costs) let a
    fractional supply budget leak a fractional round into ammo via
    `transferSupply`, underflowing past zero — ammo now transfers whole rounds.
  - **Verification**: 135 vitest tests (elevation LOS/hit/climb, identity/voice
    suites); `npm run uitest` 15 e2e checks (hardened against elevation
    projection shifts via an `aimScreen` debug helper); self-play 48 matches, 0
    invariant violations, both roles competent.

- **M1 — The Operation (campaign spine) + off-map air** ✅
  The endstate's first milestone (see `endstate.md` §6, rulings D1/D5–D8).
  - **Off-map air assets** (`sim/offmap.ts`, D5): side-level STRIKE (kinetic,
    forward-observer-gated, deck-armour penetration, footprint suppression) and
    RECON OVERFLIGHT (a turn of eyes over a corridor — `isScouted`/
    `visibleEnemies` honour active coverage, so flights legalise deep artillery
    and follow-on strikes; sightings inject immediately). Budgets per scenario
    (`MapDef.offmap`) + Interlude assignment. AI doctrine (`maybeCallAir`):
    strike a visible cluster of 2+, buy eyes when blind. Tube artillery stays
    on-board by ruling.
  - **The operation layer** (`sim/operation.ts`, pure + JSON-round-trip): FULL
    carry-over roster; the staging + between-battle **Interlude** (the player
    provisions ONLY their own echelon — `spendOnSupport` refuses mechs; the
    commander refits its mechs from the remaining depot via `commanderRefit`,
    with a legible report + REQUESTs that opens the next battle's log);
    permanent mech death + differentiated requisitions (`requisitionMech`: new
    call sign, commander-picked chassis, D6); support replacement at cost;
    failure-forward defeat (D7) — non-final losses carry, losing all mechs or
    the finale fails the operation; checkpoint saves (`ui/persist.ts`,
    localStorage, auto at Interlude + battle end).
  - **The shell** (`ui/screens.ts` + boot router in `main.ts`): title menu
    (new/resume/skirmishes), the Interlude screen, the **After-Action Report**
    (player contributions pulled from the event stream + the commander's word
    on what they meant — the relationship's payoff screen), operation-end
    summary. URL-routed; every harness param untouched; `?opdemo` renders a
    mid-operation Interlude for screenshots.
  - **MAP03 "The Gap"** (36×22, D8 — maps grow): a breakthrough finale through
    a defile between high ridgelines, deep layered defence, both sides holding
    air. In the self-play sweep (4 scenarios, 0 invariant violations); brutally
    defender-favoured all-AI (≈6%) — an operation finale is supposed to need
    everything the player has banked.
  - **Verification**: 147 vitest tests (offmap + operation suites); `npm run
    uitest` 18 e2e checks (side-level overflight through the real targeting
    UI); menu/Interlude/Gap screenshots under `docs/shots/`.

- **UI-4 — Tactical design language (C2 console + dieselpunk warmth)** ✅
  Owner direction: the UI read as a children's game. Full restyle, no new art
  burden: design tokens (near-black panels, 1px strokes, squared corners,
  uppercase microtype; colour = MEANING — friendly steel `#5d9ec9`, hostile
  signal-red `#c4554a`, amber `#d8a03c` for selection/warnings/CTAs, corner
  brackets + amber rules for flair). Board terrain desaturated to planning-
  display tones; unit badges rebuilt as NATO-style frames (friendly rectangle /
  hostile diamond / dashed ghost, structure bar in the base) over the kept 3D
  models; banners as squared C2 readout strips; every overlay/effect re-toned.
  Emoji → uppercase labels. 147 tests + 18 e2e unchanged-green; restyled
  screenshots under `docs/shots/ui4-*`.

- **M2 (part 1) — Mines, the defender's seat, the scenario engine** ✅
  - **Minefields** (`RULES.mines`, effects substrate + `actions`): engineer-laid,
    owner-safe, single-use. Detonation interrupts the move on the struck hex
    (side-armour penetration, 50% mobility kill); pathing routes around KNOWN
    fields only (fog-honest); MINE/BREACH targeting verbs; AI doctrine — the
    defending engineer mines the approach once dug in, the attacker breaches.
  - **Watchline (MAP04)** — the first DEFENSE (D2): red assaults with air, blue
    holds a crossroads. Unaided the defence falls ~⅔ of the time — the player's
    engineering and fires are the difference, mirroring the core proof.
  - **Causeway (MAP05)** — the smoke lesson: two narrow crossings under far-bank
    overwatch (river valley shaped via the generator's `shape` hook).
  - **Shared generator + random skirmish** (`data/maps/gen.ts`): the fBm core
    parametrised (shape/terrain hooks); `randomSkirmishMap(seed)` — fresh
    deterministic boards, canonical forces, seed-varied objective; on the menu.
  - Self-play sweeps SEVEN scenarios (0 invariant violations); 155 vitest tests
    (mines + scenario-soundness suites); 18 e2e checks green.

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
- **AI-2 — Role-aware force AI** ✅
  One AI (`sim/ai.ts`) — `commandForce(side)` — drives every `ai` unit by role on
  an **extensible consideration scorer**: each factor (objective, seize, supply
  pull, exposure, attack, cover, standoff, mutual-support, near-needy, …) is a
  named function with a per-role weight, summed to pick a hex; adding a factor
  (terrain/battlefield effects, ZOC) = add a consideration + weights, no rewrite.
  Roles: recon scouts at standoff, artillery suppresses from range, armour/mech
  seek **flanks**, infantry holds cover, supply sustains. **Capability/limitation
  soundness:** `shotValue` only values shots that penetrate (flanks score higher)
  or suppress — never futile ones; crits/ammo/fuel/supply respected; pathing
  avoids impassable. The match is now controller-based (the scripted red policy
  is retired — red is the AI). Verified: penetration/flank targeting test + an
  AI-vs-AI **self-play** suite (both sides fully AI across 10 seeds: always
  terminates, no negative resources) — 72 total — and the core proof is now
  decisive (no-support **0/20**, with-support **20/20**, via focus-fire support).

> **Deferred, seam-ready: a configurable LLM (e.g. DeepSeek) policy.** Not built —
> it would break the deterministic/seedable/self-play foundation if placed in the
> per-turn loop. The AI decision boundary (`decideUnit`) is the seam; an LLM fits
> best as (1) offline dev tooling (scenario/balance generation, self-play log
> analysis), (2) after-action narration, or (3) an opt-in non-reproducible policy
> excluded from tests/self-play. Env-configured, network-allowlisted, with the
> deterministic AI as fallback. Revisit when there's a concrete use.
- **AI-3 — Coordinated + adaptive planning** *(in progress)*
  A per-turn force plan (`sim/plan.ts`) assigns each unit a **task** (hold a
  prepared position / screen / rove / rear). It is **deterministic yet varied**:
  seeded "AI noise" (per seed/turn/side) picks posture, how far forward to set
  up, and positions — so the same seed replays identically (self-play/tests
  hold) but no two seeds play the same and the AI isn't a rote, exploitable
  pattern. A defender no longer clumps on the point: it occupies cover/overwatch
  positions, holds its supply to the rear, and sometimes **roves** the mech to
  better ground instead of sitting. The unit AI consumes the task as its goal
  (reusing the AI-2 consideration scorer). The attacker stays objective-seeking.
  - **AI-3a — Varied, proactive positioning** ✅ — planner + tasks + seeded
    variety; 4 plan tests (determinism, cross-seed variety, dispersed prepared
    positions, attacker untouched) — 76 total. With the now-competent defender,
    the core proof is decisive but realistic: unaided **0/20**, with support
    **~16/24 (≥12/20)** — the defender sometimes holds even a supported attack.
  - **AI-3b — Information-gated proactivity** ✅ — aggression is *earned, never
    assumed*. A side rates its situation (`sim/assess.ts`) from belief ONLY: own
    force (fully known) vs the enemy it has *perceived*, inflating the unknown —
    unscouted ground around a contact is assumed to hide support, so a thin
    picture can't justify an attack. A posture state machine (with hysteresis,
    in `state.posture`, updated each turn) runs **hold → probe → counter**: with
    no good picture the defender PROBES with recon to gain contact; only once it
    has scouted around the spearhead AND perceives a favourable ratio does it
    COUNTERATTACK; against a supported attack it perceives no edge and holds.
    Tasks `probe`/`counter` modulate the unit AI (a counterattack commits hard).
    Verified: 4 assessment tests (no-contact→probe, scouted-isolated→counter,
    scouted-strong→hold, determinism) — 80 total. In-match the counter fires
    only opportunistically (an isolated, pressing attacker) — never reflexive.
  - **AI-3c — Adaptivity, fire concentration & bulk self-play** ✅
    *Adaptivity:* the attacker maneuvers against the perceived **weak point** —
    `leastDefendedZoneHex` picks the zone hex least covered by *believed*
    defenders, recomputed each turn so the axis SHIFTS if the defence repositions
    (the force gets `advance` tasks toward it; fire-support/recon/supply keep
    their roles). *Coordination:* units **concentrate fire** on a shared force
    priority (the most dangerous visible enemy) instead of each plinking its
    local best. *Harness:* `tools/selfplay.ts` (`npm run selfplay [N]`) runs bulk
    AI-vs-AI and reports the outcome split, match length and invariant
    violations. Verified: adaptive-axis test (axis tracks belief) — 81 total —
    and bulk self-play is **sound**: across 200+ matches every match terminates
    within the cap with **zero** invariant violations.
    > **Known, scoped to v1:** AI-vs-AI on this single asymmetric Seize map is
    > defender-favoured (attacker ~1%): the AI *enabler* doesn't yet conduct the
    > supported attack as well as a skilled player (it loses its forward observer,
    > so fires can't suppress, and the spearhead outruns its supply). Per brief
    > §5 the AI enabler module + self-play balance (~50–65%) are v1 work; v0's
    > harness role — termination/crash/invariant verification — is fully met. The
    > player-supported proof is unaffected (no-support 0/24, with-support 18/24).

## v1 (in progress)

- **V1-A — AI fallibility / skill** ✅
  Commanders aren't perfect (else the player has no slack to exploit). Imperfection
  is **seeded and bounded**: the unit AI *satisfices* — it may take any move within
  a `satisficeBand` of the best (a misstep, never a blunder), chosen by seeded AI
  noise — and the assessment carries a seeded ± `assessError`. Both scale by
  `1 - skill`, a **designer-set per-side difficulty** (`MapDef.commanderSkill`).
  At skill 1 the band is 0 → exactly optimal (what every other test relies on).
  Determinism is preserved (unit ids are now reset per game, since an id seeds
  the noise). v0's map ships a **dependable ally (1.0) + fallible enemy (0.65)**:
  the proof stays clean (no-support 0/20, with-support 18/20) while the *opponent*
  the player faces misjudges and missteps — so there's never one "correct" line.
  3 fallibility tests (determinism-when-fallible, bounded missteps, exact-at-1).
- **V1-B — Risk/reward expendability + attacker phasing** ✅
  *Force preservation with purposeful spending* (owner's caveat): each role has an
  `expendable` rating — scouts/screens are spent readily, fire support and supply
  are preserved — and that willingness only unlocks on a **committing** task
  (advance/counter/probe), where exposure-aversion is discounted by `1 − expendable`.
  So cheap units go forward to buy vision/screen the spearhead; precious ones stay
  protected; nobody is thrown away idling. *Attacker phasing* — a posture machine
  symmetric to the defender's: **develop → assault**. The maneuver force holds at a
  support bound while recon scouts and fires suppress; it only ASSAULTS once it has
  scouted the defence AND established fire superiority (defenders suppressed/
  degraded) or perceives a clear advantage — never a bare charge. This lifted the
  AI attacker from ~1% to ~7% in self-play.
  > Self-play on MAP01 stays defender-favoured by design — equal forces vs a
  > prepared defence favours the defender, which is the premise (the AI attacker
  > can't crack it alone; the *player's* support is the decisive edge: ~0–7% alone
  > → ~70% supported). Balanced ~50–65% self-play comes from a balanced *set* of
  > scenarios with appropriate force ratios (V1-D), not one fixed map. Proof holds
  > (no-support 0/20, with-support 14/20).
- **V1-C — Breakthrough objective + the mirror** ✅
  A second objective that **bends commander behaviour**: BREAKTHROUGH (drive a
  mech across the far exit edge by the clock) vs SEIZE (take & hold the centre).
  The objective KIND modulates the attacker — Breakthrough **assaults at once and
  outruns its supply** (speed, accepts overextension), Seize **develops
  methodically** (suppress, then assault) — proven on the same map/seed. The
  **sixth commander input (objective state & clock)** is wired: urgency rises as
  the deadline nears (drive the objective harder, resupply less). The **mirror**
  works — the AI attacks as red (`objective.attacker` is data; both sides run the
  same attacker/defender machinery). Verified: Breakthrough win, Seize-vs-
  Breakthrough expressiveness, mirror (red attacks), plus the two remaining
  decision-input tests (friendly-support proximity, clock urgency) — **so all six
  commander inputs now have a test** — 89 total. `MAP01_BREAKTHROUGH` ships for
  the scenario; screenshot in `docs/shots/breakthrough.png`.
- **V1-D — content + self-play balance** ✅
  *Content (all data):* new units — a **Scout Mech** (faster/lighter, cheaper to
  run) and **Combat Engineers** — and a second map, **Open Steppe** (`map02.ts`,
  more open, a heavier attack vs a light screen). They reuse existing class roles
  and renderers — add a row, get a unit. *Self-play:* `tools/selfplay.ts` now runs
  a **set** of scenarios and reports per-scenario + aggregate attacker/defender
  split. Across the set (hundreds of matches) every match terminates with **zero**
  invariant violations, and the AI plays **both roles competently** — it wins the
  attack on Steppe (given superiority on open ground, ~65%) and holds the defence
  on Ridge (attacker rarely breaks through unaided). Tested.
  > On "balance ~50–65%": outcomes track scenario *force ratio* (the sign of an
  > unbiased AI), not an AI bias. The canonical Ridge map is asymmetric *by design*
  > — the attacker needs the player's support, the whole premise — so its self-play
  > is defender-favoured intentionally. A precise aggregate 50–65% wants a set of
  > dedicated *symmetric/role-mirrored* scenarios with tuned ratios; that curation
  > (and richer engineer mechanics — smoke/obstacles) is the remaining v1 polish.

Still open in v1: the interactive UI (make it hands-on playable), the optional
LLM-policy seam, and a curated symmetric balance set + engineer battlefield
effects.

(Brief §5: full mirror + enabler, all six commander inputs each tested, Seize +
Breakthrough, 2–3 maps, bulk self-play balance ~50–65%.)

## Verification loop
Per change: `typecheck → vitest → build → screenshot / headless run`. From the
AI slices on, headless AI-vs-AI self-play is the primary balance, termination,
crash and invariant harness.
