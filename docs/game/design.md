# VANTAGE — Game Design Doc

> Working title. A 2.5D bullet-heaven (Vampire Survivors / Megabonk lineage) whose
> one big idea is that **the ground is not flat** — elevation and terrain are a
> first-class mechanic, not set dressing.

Status: **Design draft** (pre-implementation). Owner: Claude + Andrew.
Last updated: 2026-06-03.

---

## 1. The pitch

You drop into a shrinking arena of hills, ridges, ramps, ledges, and pits while an
ever-growing horde funnels toward you. You auto-attack; you survive; you draft
upgrades on level-up; you build a busted endgame loadout. Standard bullet-heaven
spine — deliberately, because that loop is proven and the goal is to *iterate fast*
and ship something that feels good.

**What makes it not just another VS clone:** the arena has real geometry. The
camera is a tilted 3D view (the Megabonk angle), enemies are billboarded sprites
living in true 3D space, and **height matters to the rules**, not just the visuals.

This is also a deliberate answer to "no pancake art style": because the world is
genuinely 3D and the camera has perspective + parallax, the scene reads with depth
even with simple, cheap art. We get the Megabonk look without a 3D-modeling
pipeline by using **billboarded sprites + low-poly terrain**.

---

## 2. Design pillars

1. **Height is power, height is risk.** The defining verb is *positioning in 3
   dimensions.* Every other system bends toward making elevation a meaningful,
   constant decision.
2. **Readable chaos.** Thousands of enemies, but the player can always parse the
   threat. Depth/parallax and the tilt camera do a lot of this work for free.
3. **Build, don't grind.** Runs are won by the *combination* of upgrades, not by
   numbers going up. Synergies > stat sticks.
4. **Feel first.** Juice (hit-stop, knockback, screen-shake, number pops, death
   confetti) is a feature, not polish. A bullet-heaven lives or dies on its
   moment-to-moment crunch.

---

## 3. The differentiator: verticality & terrain

The arena is a heightmap with discrete-ish elevation bands and traversable
features. Concretely, height changes the rules in these ways:

### 3.1 Combat rules tied to elevation
- **High ground bonus.** Attacking a target *below* you grants bonus range and
  damage (a "downhill" multiplier). Attacking *uphill* is penalized. This makes
  ridges and plateaus contested, valuable real estate.
- **Line of sight / cover.** Tall terrain blocks projectiles (yours and some
  enemies'). Ridges become shields; you can break line of sight to shed pressure.
- **Falloff by drop.** Some weapons (rolling/throwing/gravity) gain power with the
  *height delta* they travel down. Lobbed weapons arc over walls.

### 3.2 Movement & traversal
- **Slopes** cost/grant speed (downhill = faster, uphill = slower) — kiting
  decisions become terrain-aware.
- **Ledges & pits.** Pits are instant-death hazards you can kite enemies into (and
  fall into yourself if careless). Knockback can shove enemies off ledges →
  fall damage / instakill on big drops. **The swarm's density becomes a weapon
  when you fight near a cliff.**
- **Ramps & jump pads** let you reposition between bands quickly — the core
  "escape valve" when surrounded.

### 3.3 Enemy behavior tied to terrain
- Ground enemies must *pathfind* around walls and up ramps → terrain naturally
  channels the horde into kill-funnels and chokepoints (player-exploitable).
- Some enemies are flyers (ignore terrain, ignore high-ground rules) — a deliberate
  counter that forces you to not over-commit to one ridge.
- Spawn director can use elevation: spawn behind ridges (ambush) or below the
  player (telegraphed climb).

### 3.4 Why this is the right differentiator for *this* build
- It's **emergent from systems**, not bespoke content — cheap to author, deep to
  play. A heightmap + a few rules generates endless tactical situations.
- It's **maximally synergistic with the 2.5D render** — the thing that makes it
  look distinct is the same thing that makes it play distinct.
- It's **code-expressible end-to-end**, which fits the "how much can Claude build
  solo" goal: no art-heavy or editor-heavy dependencies.

---

## 4. Core game loop

```
Spawn into arena (terrain seed)
   ↓
[ 30–40 min run, escalating waves ]
   • Move (3D, terrain-aware)         ← player skill
   • Auto-weapons fire on cadence     ← build
   • Kill enemies → drop XP gems      ← they roll downhill toward low ground (!)
   • Level up → draft 1 of 3–4 upgrades
   • Pick up chests → evolve weapons
   • Survive timed boss waves
   ↓
Win (survive the clock) or Die → meta progression unlock → next run
```

Note the small terrain twist already baked into the loop: **XP gems roll downhill.**
Low ground becomes a tempting but dangerous place to farm pickups — another reason
height is a live decision every second.

### Run length & pacing
- Target run: **20–30 min** to start (shorter than VS's 30; tighter is better for
  iteration and for "one more run" feel).
- Difficulty escalates on a curve: enemy count, HP, speed, and *new enemy types*
  introduced on a timeline + boss spikes every ~5 min.

---

## 5. Systems (MVP → later)

| System | MVP | Later |
|---|---|---|
| Movement | 3D, terrain-aware speed | dash, jump pads, slide-on-slope |
| Weapons | 1 auto-weapon | 6–8 weapons, evolutions, weapon classes |
| Upgrades | level-up draft of stat/weapon cards | passives, synergy sets, banish/reroll |
| Enemies | 1 chaser type | flyers, tanks, splitters, ranged, elites, bosses |
| Terrain | static heightmap + high-ground dmg + pits | destructible, hazards, biomes, shrinking arena |
| Pickups | XP gems (roll downhill) | gold, chests, magnets, health, bombs |
| Meta | none | unlock characters/weapons, persistent upgrades |
| Juice | hit flash + knockback | hit-stop, shake, crits, number pops, SFX/music |

### Weapon archetypes (designed to exploit terrain)
- **Downhill weapons** — rolling boulders, ricochet shots that gain power per drop.
- **Lobbers** — arc over walls; ignore line-of-sight; good vs entrenched.
- **Aura/orbit** — terrain-agnostic baseline so there's always a safe pick.
- **Knockers** — high knockback; the "shove them off the cliff" build.

---

## 6. Player fantasy & characters (later)
Different starting characters bias toward terrain styles:
- **The Vantage** — sniper; huge high-ground bonus, weak on flat/low ground.
- **The Avalanche** — knockback/downhill bruiser; wants ledges and slopes.
- **The Drifter** — flat-ground generalist; flyers don't scare them.

(One generic character for MVP. Characters are a meta-progression hook for later.)

---

## 7. Art & audio direction
- **Look:** low-poly / lightly-shaded 3D terrain (flat-ish colors, soft fog for
  depth), **billboarded sprite enemies** (2–4 frame animations) for that crisp
  readable-against-3D pop. Think Megabonk's depth with a cleaner, less "asset-flip"
  palette. Strong silhouettes, high contrast between player / enemy / terrain /
  pickups.
- **Color as information:** elevation tinting (higher = cooler/lighter) so the
  player reads height at a glance. Threat color-coded.
- **Audio (later):** punchy short SFX, adaptive intensity music that ramps with
  on-screen enemy count.
- **MVP art:** placeholder primitives + flat-color billboards. Art is explicitly a
  *later* concern — systems and feel first.

---

## 8. Scope & non-goals
- **In scope:** single-player, single arena type to start, run-based, keyboard +
  mouse (and gamepad later), runs in the browser.
- **Non-goals (for now):** multiplayer, mobile, story/narrative, procedurally
  *infinite* worlds, a marketplace of cosmetics, 3D-modeled characters.
- **Hard rule:** every feature must justify itself against "does this make
  *positioning in 3D* more interesting?" If not, it waits.

---

## 9. Resolved questions & open ones
Resolved during M0–M2:
- **Run length:** 30 min max.
- **Terrain:** continuous heightmap (not discrete tiles), **seeded-procedural
  with handcrafted POIs** (central plateau + lethal pits). ✅ implemented in M2.
- **Pits/ledges:** pits = instant death (player and enemies); knockback shoves
  enemies toward them — they're kite-able kill-zones. ✅ M2.
- **Menu flow:** end goal is title → theme selection → character selection →
  gameplay. The `RunConfig`/`startRun` seam landed in M2; the actual shell is a
  later milestone (M4.5) — see `architecture.md`.

Still open:
- Aim model: pure auto-target (VS) for now; revisit an aimed primary later if the
  game wants more skill expression.
- Whether high-ground checks should snap to coarse bands for readability, or stay
  continuous (currently continuous height delta).
- How hard the difficulty curve should ramp, and where bosses land (M3).

See `architecture.md` for the technical plan, data layout, and milestones.
