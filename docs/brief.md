# Build Brief — Vantage *(working title)*

> **Source of truth for the design.** Treat it as the spec; do not deviate from
> the locked decisions without flagging.
>
> **Resolved with the owner (2026-06):**
> - **Win/Loss:** blue wins by achieving the mission objective. Blue loses on
>   objective failure (clock/zone) **OR** all friendly mechs destroyed **OR** all
>   player support units depleted.
> - **v0 control:** ships an interactive click-to-act UI *and* the headless
>   scripted harness, both driving one shared player-action API.
> - **Heightmap:** **visual** in v0 — the continuous heightmap drives the 2.5D
>   render; the sim's cover/"approach exposure" comes from per-hex terrain *type*.
>   Elevation becomes a mechanical input (LOS/range/cover/move-cost) in v1.

You are building a turn-based, hex-based combined-arms tactics game from
scratch, fully autonomously where possible.

---

## 1. Overarching Goal

Build a playable vertical slice of a tactics game with a single, unusual core
premise: **the player commands the supporting effort and the supply line, not
the main effort.** The heaviest units — the mechs — are controlled by an
autonomous AI commander. The player never pilots them. The player wins or loses
by *enabling* that autonomous main effort to succeed: feeding it supply, vision,
and fire support, and shaping the battlefield so the AI's own logic carries it
to the objective.

The build must be structured so it can be developed and verified largely without
a human in the loop (headless test harness, screenshot inspection, AI-vs-AI
self-play), and so content and balance iterate by editing data, not code.

**The single hypothesis this slice must prove:** a player controlling only
support and logistics can meaningfully and legibly change the outcome of a
battle fought by an autonomous main effort. If that proves true, the game is
real. Everything in v0 exists to test exactly this.

---

## 2. Concept Description

### Identity
"Fighting at the end of a supply line." A combined-arms tactical battle on a hex
grid where facing and supply geometry matter as much as firepower. No unit is
the mechanically deep "star" — depth lives in the *system* (combined arms,
positioning, sustainment) and in the interaction between the player and an
autonomous allied AI.

### The two sides of control
- **The player** directly controls every non-mech element: recon/EW, artillery
  and indirect fire, armored vehicles, infantry, engineers, and logistics/supply
  units. The player's direct offensive outlet is artillery/fires; everything
  else is shaping, screening, holding, and sustaining.
- **The mechs** (the main effort) are controlled by an autonomous **mech
  commander AI**. The player issues *no orders* to the mechs — no intent button,
  no tasking interface. The player influences the mechs **only** by changing the
  battlefield conditions the commander reasons over.

### The mech commander AI
A capability-aware, objective-seeking **utility AI**: it scores candidate actions
and takes the highest-value one, pursuing the mission objective in the most
logical way given its units' present capabilities and limitations. It must be:
- **Legible** — the player must be able to predict and shape it. A readable
  current-intent indicator is surfaced every turn ("massing for left-axis push",
  "breaking contact, low ammo"). Legibility is a *gameplay requirement*: if the
  AI is a black box, the player cannot form intentions and the design collapses.
- **Deterministic and seedable** — same seed and inputs → same decisions.
- **Inspectable** — a transparent utility/scoring module, unit-testable
  ("ammo < threshold → breaks contact toward nearest supply").

**The commander's decision inputs ARE the player's influence surface:**

| Input the commander weighs | The player's lever |
|---|---|
| Own sustainment (ammo %, fuel/MP, crit damage) | Resupply, repair, forward depots |
| Known enemy (vision-gated) | Recon / EW reveals; no recon → blind, cautious |
| Enemy suppression / degradation | Artillery/fires suppress, lowering an axis's cost |
| Approach exposure (cover, terrain, flank security) | Smoke, engineering, screening units |
| Friendly support proximity (overwatch, supply) | Position armor/infantry to validate an axis |
| Objective state and clock | Fixed by the mission; sets urgency/risk tolerance |

The intended tension: the commander pursues the objective on its own will and
will sometimes commit past its supply because the mission demands it, forcing the
player to scramble to sustain an advance they didn't pick. Preserve that.

### Combat model (uniform across ALL units)
One model for everything — mech, tank, APC, gun, infantry:
- **Armor by facing** (front / side / rear — hexes give this for free).
- **Structure pool** behind armor.
- **Small shared crit table** (~4 states): mobility-killed, weapon-killed,
  sensors/comms-killed, crew-shaken. Crits are mission-kills, not removals.
- **Suppression / morale** — gives infantry and artillery a job beyond damage.
- Mechs differ **only** by capability, sustainment cost, and terrain access —
  not mechanical depth. **No heat system** (finite ammo/supply does that job).

### Tactical logistics (on the battlefield, not a between-missions screen)
- Finite **ammo** per weapon per engagement and **fuel/MP** that depletes with
  movement.
- **Supply units / forward depots** resupply adjacent friendly units.
- **Supply-line tracing**: a unit that cannot trace a path back to a supply
  source goes dry — first no resupply, then escalating fire/move penalties.
- Artillery and air-equivalents are powerful but logistically expensive
  (self-balancing).

### Objectives (load-bearing — bend commander behavior)
Machine-readable definitions, each producing different commander behavior:
- **Seize** — take and hold a zone by turn N (default).
- **Hold** — defend N turns (defensive; stresses ammo endurance).
- **Breakthrough** — cross/exit a map edge (pushes hard, accepts overextension).
- **Destroy / Escort** — later.

### Symmetry
Full mirror. The enemy uses the **same** mech commander AI plus an **AI enabler
module** playing the support role. This yields a clean opponent and **AI-vs-AI
self-play** as the primary headless verification harness.

### Loss condition
See the resolved decision at the top: objective failure, or all friendly mechs
destroyed, or all player support units depleted.

---

## 3. Architecture & Build Constraints
- **Single self-contained codebase, minimal dependencies.**
- **Pure-function deterministic simulation core, separated from rendering.**
- **Seed all randomness. Log every roll** for the test harness.
- **Data-driven content** — units, weapons, crit tables, objectives, maps.
- **The mech commander and AI enabler are reusable modules** (player AI, enemy,
  self-play).
- **Must run headless** and **produce screenshots** of board state.
- **Turn structure:** phased initiative (recon/light first, with a reserve
  mechanic) so recon → fires → maneuver sequencing matters.
- **Programmer art only.**

---

## 4. v0 — Contents (proof of the core hypothesis)
Smallest build proving a support-only player can change a battle's outcome.

- Hex grid with facing; one small handcrafted map.
- Uniform combat model: facing armor + structure + 4-state crit table.
- Minimal units: 1–2 mech types (AI) + player recon, artillery, one armor, one
  infantry, one supply.
- Mech commander utility AI pursuing **Seize**, reading at least: own
  sustainment, known (vision-gated) enemy, enemy suppression, approach exposure.
- Tactical logistics: finite ammo, adjacent resupply, supply-line tracing with
  dry-out penalties.
- Phased turn order; seeded determinism with roll logging.
- Commander surfaces a readable current-intent string each turn.
- Headless harness: launch, run a scripted scenario, dump state, capture a board
  screenshot. Plus the interactive UI (resolved).

**Acceptance criteria (falsifiable):**
1. **The core proof:** a fixed seeded scenario where, with *no* player support,
   the AI mechs fail the Seize objective; and the *same* seeded scenario succeeds
   when a defined set of player support actions (resupply + suppressive fire +
   recon) is applied. The delta must be attributable to player action.
2. Deterministic under a fixed seed.
3. No invariant violations: supply never negative; every match terminates within
   a turn cap.
4. Commander exposes a human-readable intent every turn.
5. Runs headless and outputs a board-state screenshot.

If criterion 1 cannot be met, stop and report.

---

## 5. v1 — Contents (first complete, balanced single-battle experience)
- Full mirror: enemy mech commander + enemy AI enabler.
- All six commander decision inputs implemented and wired.
- Full player toolkit: recon/EW, artillery/fires, armor, infantry, engineers,
  logistics/supply.
- Suppression/morale fully in.
- At least **Seize** and **Breakthrough** objectives live.
- A few unit types and 2–3 maps, all data tables.
- AI-vs-AI self-play runnable in bulk and headless.

**Acceptance criteria:**
1. **Self-play stability/balance:** over N seeded matches — always terminate, no
   crashes, all invariants hold, neither side wins more than ~60–65%.
2. **Input coverage:** one test per commander decision input proving changing it
   alone changes the chosen action.
3. **Objective expressiveness:** Seize vs Breakthrough produce measurably
   different commander behavior on the same map/seed.
4. Full player toolkit usable; all content in data tables.

---

## 6. Non-Goals (do NOT build in v0/v1)
- No campaign / strategic-meta layer, salvage, economy, roster progression.
- No mech customization / mechlab.
- No heat system.
- No save/load (minimum if unavoidable).
- No multiplayer. No audio, real art, or animation polish. No UI gold-plating.
- **No direct player control of mechs and no intent/tasking interface — ever.**
  Load-bearing to the design, not a missing feature.

---

## 7. Verification Expectations
- **Unit tests** on sim invariants and individual commander decisions.
- **Headless self-play** as the primary balance/termination/crash/invariant
  harness.
- **Screenshot checks** for render sanity (units on-board, facing legible,
  supply lines visible).
- Build in vertical slices with self-verification at each commit; run
  autonomously within a slice, gate between slices.
