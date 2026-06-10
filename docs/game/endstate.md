# VANTAGE — End-State Vision (the road to 1.0)

> Companion to [`../brief.md`](../brief.md) (the founding spec, still binding) and
> [`architecture.md`](architecture.md) (the build log). This document is the
> **destination**: what the finished game is, what it will never be, and the
> milestones between here and there. Drafted collaboratively (owner + Claude);
> decision points below are marked ⚖ until ratified.

---

## 1. What this game is (the soul)

VANTAGE is the game where **you are not the hero**. You run the supporting
effort — fuel, rounds, eyes, fires, and ground — for a named, autonomous,
fallible main effort that fights its own battle. The fantasy is the S2/S4/fires
cell, not the trigger: *Vanguard takes the ridge because you fed it, screened
it, blinded the guns that would have stopped it — and Vanguard never knows.*

Three properties are load-bearing and non-negotiable:

1. **No direct control of the main effort. Ever.** Not orders, not waypoints,
   not "suggestions". The player's only language is the battlefield itself.
2. **Legibility.** The commander's mind is always readable — intent banners,
   the needs panel, the assessment it acts on. You can't command it, but you
   can always understand it. Influence without legibility is a slot machine.
3. **One honest sim.** Player, allied AI, and enemy all act through the same
   action API, the same fog, the same ground queries. No cheating in either
   direction — the proof harness keeps everyone honest.

## 2. Design pillars (how every feature gets judged)

- **P1 — The relationship is the game.** Features that deepen the bond between
  player and the named main effort (voice, needs, consequence, memory) beat
  features that add raw tactical content.
- **P2 — Geometry over micro.** The player's skill expression is *placement*:
  supply lines, sightlines, smoke walls, fortified ground, fire footprints.
  Never reflexes, never per-unit optimization grind.
- **P3 — Earned information.** Fog is the real enemy. Anything that grants
  vision must be paid for; anything unseen must stay genuinely unseen (render,
  log, selection — everywhere).
- **P4 — Data is content.** New units, effects, weather, objectives, maps and
  commander temperaments are table rows on existing substrates. If a feature
  needs a new code branch per instance, the substrate is wrong.

## 3. The 1.0 experience (what shipping looks like)

A browser game, no install. You open it and get:

- **A title/menu screen** with: the Operation (the campaign), Skirmish
  (seeded generator), and Scenario Select (the handcrafted set).
- **The Operation** — a linked 5–6 battle narrative arc following one task
  force, with **full carry-over** (D1 ✓): damage, crits, ammo, fuel and losses
  all persist. Losing Vanguard in battle two means fighting battle three
  without it — and a different voice in the needs panel.
- **The Interlude** (D1 ✓ — owner's design): between battles, an operational
  pause with a **logistics management menu**. The player allocates a finite
  operation stockpile — ammunition, fuel, repair capacity, replacement
  vehicles — across their OWN support echelon and the forward depot. The
  division of labour mirrors the battlefield rule exactly: **the commander
  refits its mechs itself** from whatever the player puts in the depot — the
  player never manages mech specifics, only what's available to them. The
  commander's interlude choices are legible (a refit report + requests:
  "Vanguard needs a week of armour work — give me the plates and it fights in
  battle four"), so the player shapes outcomes through provisioning, never
  through tasking. The no-direct-control rule extends to the depot.
- **Each battle**: the existing loop, matured — fog, gestures, fire missions,
  fortification, elevation, commander needs — plus an **After-Action Report**:
  the commander's own readout of what happened ("We held because the eastern
  guns went quiet. That was you.") built from the event stream. The AAR is
  where the player's invisible work becomes visible — P1's payoff screen.
- **Both seats** (D2 ✓): scenarios where your side defends — you fortify,
  screen, and keep a counter-attacking main effort supplied — not just the
  attack.
- **Commander temperaments** (D3 ✓): per-call-sign presets (utility-weight +
  voice flavor) so Vanguard (methodical) and Saber (aggressive) *play and talk
  differently*, and scenarios can cast them deliberately. Fallibility stops
  being noise and becomes character.
- **A living battlefield** (D4 ✓, scoped to two conditions): rain (vision
  down, mud move-cost up) and night (vision halved, sensors matter) as effect
  rows on the existing substrate. Plus **mines** as the third engineer verb
  (lay/clear), completing the effects family.
- **Difficulty** = enemy commander skill + force ratio per scenario (both
  already data). Scenario one *is* the tutorial — the needs panel teaches.

## 4. Feature map

### Done (the foundation — v0 through V1-ELEV)
Deterministic sim · uniform combat · phased initiative + reserve · logistics &
supply tracing · per-side fog + belief · utility commander (role-aware, varied,
information-gated, fallible) · self-play harness · core proof · interactive UI
(BattleTech-style gestures) · player fog rendering · sim event stream +
animated stage · procedural models/effects · fire missions / smoke / fortify ·
commander needs · mechanical elevation · call signs + terrain voice.

### To build (milestones)

**M1 — The Operation (campaign spine)**
- Scenario-select + title screen; the linked operation structure (data-driven:
  an operation is a list of scenario refs + carry-over rules). Full carry-over
  of unit state (damage, crits, ammo, fuel, losses) per D1.
- **The Interlude**: the between-battles logistics menu. A finite operation
  stockpile (ammo / fuel / repair capacity / replacement support vehicles) the
  player allocates to their echelon + the forward depot; the commander refits
  its own mechs from the depot autonomously, with a legible refit report and
  requests. (Pure sim module + a DOM screen — same architecture rules.)
- Persistence layer (localStorage save of operation state — the brief's
  "minimum save/load if unavoidable"; it's now unavoidable and small).
- The After-Action Report screen (event-stream derived; commander-voiced).
- Acceptance: play the operation end-to-end; a mech lost in battle N is absent
  in N+1; a starved depot visibly degrades the next battle's mech readiness;
  AAR names the player's three highest-impact contributions.

**M2 — Content engine (scenarios, both seats, ground truth)**
- 6–8 handcrafted scenarios, each teaching one support verb (ridge recon duel,
  convoy escort, river/defile crossing, smoke-covered withdrawal, defender
  counter-punch, breakthrough exploitation).
- Defender-seat support play (D2 ✓) — UI/needs/AAR already side-aware.
- Mines (effect row + engineer lay/clear + AI awareness via shared queries).
- Skirmish generator (seeded map gen already exists; add force-picker presets).
- Acceptance: scenario set complete; self-play green across all of them.

**M3 — Character (the relationship layer)**
- Commander temperaments as data presets (D3 ✓); per-call-sign voice tables.
- Needs panel referencing temperament ("Saber wants the gap NOW; it will
  overextend — screen its flank").
- Weather/time effect rows — rain + night (D4 ✓) + presentation (light rig,
  particles).
- Acceptance: two temperaments observably diverge in self-play on the same
  seed; weather changes AI behaviour through the shared queries alone.

**M4 — Ship (shell & polish)**
- Menu/settings (animation speed, camera, colorblind-safe palette), pause/
  rules reference, balance pass across the full set, perf pass, itch/web
  deploy pipeline.
- Acceptance: a stranger can go from URL to finishing the operation without
  being told anything that the game doesn't tell them.

### Post-1.0 (parked, with seams kept warm)
- **LLM commander layer** (owner: bigger than originally scoped — deferred).
  The seam stays: utility AI remains the decision floor; an LLM layer would
  first only *narrate* (voice/AAR flavor over real decisions), and only later,
  maybe, advise. Never replaces the deterministic core (the proof depends on it).
- Replay viewer (owner: cut — the event stream keeps the door open for free).
- Audio (brief still says no; revisit at 1.0).
- Multiplayer, mechlab, economy: **never** (see §5).

## 5. Never list (protecting the soul)
- No direct/indirect tasking of mechs (no waypoints, no "priorities" UI).
- No mech customization/mechlab, no economy/salvage grind, no 4X meta.
- No real-time mode. No multiplayer. No heat system.
- No omniscient spectator toggles in normal play — fog is the game.

## 6. Ratified decisions (owner, 2026-06-10)

| # | Question | Ruling |
|---|----------|--------|
| D1 | Campaign persistence | **Full carry-over** (damage, crits, ammo, fuel, losses), plus an **Interlude** between battles: a logistics-management stage where the player allocates a finite operation stockpile to their support echelon and the forward depot. **The commander refits its own mechs** from what the player provisions — the no-direct-control rule extends to the depot (provision, never task). |
| D2 | Defender seat at 1.0 | **First-class** — the scenario set includes 2–3 defenses. |
| D3 | Commander character | **Temperament presets** — per-call-sign utility-weight + voice presets; commanders play and talk differently. |
| D4 | Weather/time-of-day | **In for 1.0**, scoped to two conditions: rain and night, as effect rows. |

### M1 scope rulings (owner, 2026-06-11)

| # | Question | Ruling |
|---|----------|--------|
| D5 | Off-map assets | **Strike + recon overflight**, both sides, in M1. **No off-map artillery** — tube artillery stays an on-board unit by design. Strikes obey the forward-observer rule; overflights buy a turn of eyes (and are themselves observers). Budgets per scenario + Interlude assignment. |
| D6 | Mech requisition | Death stays permanent; a requisition fields a **fully differentiated NEW entity** — new call sign (never reissued), commander-chosen chassis, its own loadout. High cost. |
| D7 | Defeat & saves | Failure-forward confirmed, **with checkpoint saves**: auto-save at every Interlude and battle end (localStorage); resume from the menu. |
| D8 | Map scale | **Maps grow** as unit-type count and battlefield complexity grow — started with The Gap (36×22); the M2 scenario set continues the trend. |

---
*Maintained as decisions land. M1 (Operation spine) shipped: carry-over,
Interlude, AAR, saves, off-map air, menu/shell, MAP03. Next checkpoint: M2
scoping (scenario set, defender seat, mines, skirmish generator).*
