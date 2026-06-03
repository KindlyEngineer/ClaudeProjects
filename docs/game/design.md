# VANTAGE — Game Design Doc

> Working title (the name predates the current direction — open to a rename).
> A 2.5D bullet-heaven (Vampire Survivors / Megabonk lineage) whose one big idea
> is that **the arena is real tactical space** — walls, cover, chokepoints and
> hazards that block fire and shape the horde, not a flat field.

Status: **In development (M0–M2 built).** Owner: Claude + Andrew.
Last updated: 2026-06-03.

> **Direction note (2026-06-03):** the differentiator pivoted from *verticality /
> elevation* (a continuous heightmap, explored and built in an earlier M2) to
> **tile-based arenas with blocking geometry & line-of-sight** — closer to a more
> open SYNTHETIK 2. Sections below reflect the new direction; the elevation
> framing is retired.

---

## 1. The pitch

You drop into an arena of walls, cover, columns, crate clusters and hazard pools
while an ever-growing horde funnels toward you through the gaps. You auto-attack;
you survive; you draft upgrades on level-up; you build a busted endgame loadout.
Standard bullet-heaven spine — deliberately, because that loop is proven and the
goal is to *iterate fast* and ship something that feels good.

**What makes it not just another VS clone:** the arena is real navigable
geometry, not an open field. **Walls block movement, projectiles and line of
sight; chokepoints funnel the swarm; hazards are kill-zones.** Cover means *you*
can break line of fire — and so can enemies. The camera is a tilted 3D view (the
Megabonk angle) and enemies are billboarded sprites in true 3D space.

This is also a deliberate answer to "no pancake art style": the world is genuinely
3D (the cover/walls have real height and cast shadows under the tilt camera), so
the scene reads with depth even with simple, cheap art — **billboarded sprites +
low-poly tile geometry**, no 3D-modeling pipeline.

---

## 2. Design pillars

1. **Geometry is the game.** The defining verb is *positioning relative to cover
   and chokepoints.* Every other system bends toward making the arena's walls,
   gaps and hazards a meaningful, constant decision.
2. **Readable chaos.** Thousands of enemies, but the player can always parse the
   threat. Depth/parallax and the tilt camera do a lot of this work for free.
3. **Build, don't grind.** Runs are won by the *combination* of upgrades, not by
   numbers going up. Synergies > stat sticks.
4. **Feel first.** Juice (hit-stop, knockback, screen-shake, number pops, death
   confetti) is a feature, not polish. A bullet-heaven lives or dies on its
   moment-to-moment crunch.

---

## 3. The differentiator: geometry, cover & hazards

Each arena is a **grid of tiles assembled from pre-made chunks** — a flat
walkable floor studded with blocking geometry and hazards. Reference point: a
*more open* SYNTHETIK 2 (big arenas, scattered hard cover, emphasis on hazards).
Concretely, geometry changes the rules in these ways:

### 3.1 Combat rules tied to geometry
- **Line of sight / cover.** Walls and cover (crates, columns) block projectiles
  — yours *and* enemies'. The auto-weapon won't fire through walls, so you break
  line of fire to shed pressure, and enemies can hide behind cover. *(Ricochet off
  cover, à la SYNTHETIK, is a candidate later mechanic.)*
- **Chokepoints.** Gaps between structures funnel the horde into tight lanes —
  ideal kill-corridors for piercing/area weapons.
- **Hazards.** Hazard tiles (the old "pits", reborn flat) are instant-death
  kill-zones. **Knockback shoves enemies into them** — the swarm's density becomes
  a weapon when you fight beside a hazard.

### 3.2 Movement & positioning
- **Walls stop you** (you slide along them) — corners and dead-ends are real
  risks when surrounded; the open central plaza is the safe-but-exposed default.
- **Hazards are lethal to walk on**, so the floor itself is a positioning puzzle.
- Cover lets you **peek and reposition** — duck behind a wall to break a bad
  line of fire, then re-engage.

### 3.3 Enemy behavior tied to geometry
- The horde uses **flow-field pathfinding** over the tile grid, so it routes
  *around* walls and *through* gaps — geometry naturally channels it into
  chokepoints you can exploit.
- Enemies avoid hazards on their own (the flow field won't path through them), so
  the only way they enter a hazard is **knockback** — making "shove them in" a
  deliberate play.
- Flyers (later) ignore walls — the deliberate counter that stops you turtling in
  one cover nook.

### 3.4 Why this is the right differentiator for *this* build
- It's **emergent from systems** — a chunk palette + a few tile rules (block,
  LOS, hazard) + flow-field pathing generates endless tactical arenas, cheaply.
- It maps cleanly onto the **menu's "level theme" selection**: a theme *is* a
  tileset + palette.
- It's **code-expressible end-to-end** (no editor, no art pipeline), fitting the
  "how much can Claude build solo" goal — arenas are authored as text chunks.

---

## 4. Core game loop

```
Spawn into a tile arena (level seed → chunk layout)
   ↓
[ ~30 min run, escalating waves ]
   • Move (around walls, off hazards)  ← player skill
   • Auto-weapon fires on cadence      ← build (won't shoot through walls)
   • Kill enemies → drop XP gems       ← collected via magnet
   • Level up → draft 1 of 3–4 upgrades
   • Pick up chests → evolve weapons
   • Survive timed boss waves
   ↓
Win (survive the clock) or Die → meta progression unlock → next run
```

The live decision every second is **where you stand relative to cover and
hazards**: hug a wall to break enemy lines of fire, fight beside a hazard so
knockback shoves the swarm in, but don't get cornered in a dead-end.

### Run length & pacing
- Target run: **20–30 min** to start (shorter than VS's 30; tighter is better for
  iteration and for "one more run" feel).
- Difficulty escalates on a curve: enemy count, HP, speed, and *new enemy types*
  introduced on a timeline + boss spikes every ~5 min.

---

## 5. Systems (MVP → later)

| System | MVP | Later |
|---|---|---|
| Movement | slide along walls, hazards lethal | dash, destructible cover |
| Weapons | 1 LOS-gated auto-weapon | 6–8 weapons, evolutions, weapon classes |
| Upgrades | level-up draft of stat/weapon cards | passives, synergy sets, banish/reroll |
| Enemies | 1 flow-field chaser | flyers, tanks, splitters, ranged, elites, bosses |
| Arena | tile grid (walls/cover/hazard) from chunks | more chunk sets, biomes, destructible, ricochet |
| Pickups | XP gems (magnet) | gold, chests, magnets, health, bombs |
| Meta | none | unlock characters/weapons, persistent upgrades |
| Juice | hit flash + knockback | hit-stop, shake, crits, number pops, SFX/music |

### Weapon archetypes (designed to exploit geometry)
- **Piercing/lane** — shred enemies funneled into a chokepoint.
- **Lobbers** — arc over walls; ignore line-of-sight; good vs enemies behind cover.
- **Aura/orbit** — cover-agnostic baseline so there's always a safe pick.
- **Knockers** — high knockback; the "shove them into the hazard" build.

---

## 6. Player fantasy & characters (later)
Different starting characters bias toward geometry play-styles:
- **The Sentinel** — long-range; rewards holding sightlines down chokepoints.
- **The Bruiser** — heavy knockback; wants to fight beside hazards and shove.
- **The Drifter** — mobile generalist; comfortable in the open, dodges flyers.

(One generic character — the Drifter — for now. Characters are the second half of
the menu flow and a meta-progression hook.)

---

## 7. Art & audio direction
- **Look:** low-poly / lightly-shaded 3D terrain (flat-ish colors, soft fog for
  depth), **billboarded sprite enemies** (2–4 frame animations) for that crisp
  readable-against-3D pop. Think Megabonk's depth with a cleaner, less "asset-flip"
  palette. Strong silhouettes, high contrast between player / enemy / terrain /
  pickups.
- **Color as information:** walls/cover read as solid neutral mass; hazards glow
  hot (emissive) so danger tiles are unmistakable; threats color-coded.
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
  *positioning relative to cover, chokepoints and hazards* more interesting?"
  If not, it waits.

---

## 9. Resolved questions & open ones
Resolved so far:
- **Run length:** 30 min max.
- **Terrain model:** **tile grid assembled from pre-made chunks** — flat floor,
  blocking walls/cover, lethal hazard tiles. (Superseded an earlier continuous-
  heightmap/verticality build; elevation as a mechanic is retired.) ✅
- **Hazards:** instant death (player and enemies); the flow-field horde avoids
  them, so knockback is the way to shove enemies in — kite-able kill-zones. ✅
- **Enemy pathing:** grid flow-field (routes around walls, through gaps). ✅
- **Cover/LOS:** walls + cover block movement, projectiles and the weapon's line
  of fire. ✅ (Ricochet off cover deferred.)
- **Menu flow:** title → theme selection → character selection → gameplay. The
  `RunConfig`/`startRun` seam is in; theme = tileset. Shell is M4.5.

Still open:
- Aim model: pure auto-target (VS) for now; revisit an aimed primary later.
- Half-cover (blocks fire but not movement) vs current hard-cover-only.
- Whether to add ricochet-off-cover (a SYNTHETIK signature).
- Difficulty-curve ramp and where bosses land (M3).

See `architecture.md` for the technical plan, data layout, and milestones.
