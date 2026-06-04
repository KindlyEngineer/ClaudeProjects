import type { Direction, Hex } from "../sim/hex";

// Data schemas. Everything the game is made of — terrain, units, weapons, crit
// table, objectives, maps — is plain data so content extends by adding rows and
// balance tunes without touching code (per the build brief, §3). The sim reads
// these tables; it never hardcodes a specific unit or terrain in a branch.

// ── Sides & control ─────────────────────────────────────────────────────────
export type Side = "blue" | "red";

/** Who issues a unit's orders. Set per-unit in scenario data (the campaign
 *  designer decides AI vs player ahead of time). The AI commands every `ai`
 *  unit, role-aware; the player commands the `player` ones. */
export type Controller = "ai" | "player";

/** Unit role. `mech` units are driven by the autonomous commander AI and are
 *  never player-ordered; everything else is the support/logistics effort. */
export type UnitClass =
  | "mech"
  | "recon"
  | "artillery"
  | "armor"
  | "infantry"
  | "engineer"
  | "supply";

// ── Terrain ─────────────────────────────────────────────────────────────────
export interface TerrainType {
  readonly id: string;
  readonly name: string;
  readonly color: number; // render tint (programmer art)
  readonly moveCost: number; // MP to enter (Infinity = impassable to ground)
  readonly cover: number; // defensive bonus to occupants (combat, later slices)
  readonly blocksLineOfSight: boolean; // reserved for v1 LOS
}

// ── Weapons & combat ────────────────────────────────────────────────────────
export interface WeaponDef {
  readonly name: string;
  readonly damage: number; // structure damage on a penetrating hit
  readonly rangeMin: number; // hexes (0 for direct)
  readonly rangeMax: number;
  readonly accuracy: number; // base to-hit [0,1] before modifiers
  readonly suppression: number; // morale/suppression applied on/near hit
  readonly ammoMax: number; // shots carried per engagement (finite)
  readonly indirect: boolean; // artillery: arcs over, ignores facing LOS
  readonly penetration: number; // vs the target's facing armour value
}

/** The four shared crit states (brief §2). A crit is a mission-kill, not a
 *  removal — a mobility-killed unit is a stranded problem, still on the board. */
export type CritState = "mobility" | "weapon" | "sensors" | "shaken";

export interface UnitType {
  readonly id: string;
  readonly name: string;
  readonly cls: UnitClass;
  readonly armor: { readonly front: number; readonly side: number; readonly rear: number };
  readonly structure: number;
  readonly move: number; // MP per turn
  readonly fuelMax: number; // movement-point fuel pool (depletes with moves)
  readonly vision: number; // sight range in hexes
  readonly weapons: readonly WeaponDef[];
  readonly supplyCapacity?: number; // supply units only: resupply budget
  readonly light: boolean; // acts in the recon/light initiative phase
}

// ── Objectives ──────────────────────────────────────────────────────────────
export type ObjectiveKind = "seize" | "hold" | "breakthrough";

export interface ObjectiveDef {
  readonly kind: ObjectiveKind;
  readonly turnLimit: number;
  /** Seize/Hold: the zone hexes. Breakthrough: the exit-edge hexes. */
  readonly zone: readonly Hex[];
  /** Which side the *commander* (blue mechs) is trying to achieve it for. */
  readonly attacker: Side;
}

// ── Maps ────────────────────────────────────────────────────────────────────
export interface MapCell {
  readonly hex: Hex;
  readonly terrain: string; // TerrainType id
  readonly elevation: number; // height (visual heightmap in v0)
}

export interface UnitPlacement {
  readonly type: string; // UnitType id
  readonly side: Side;
  readonly hex: Hex;
  readonly facing: Direction;
  readonly controller?: Controller; // default "ai"; mark player-run units explicitly
}

export interface MapDef {
  readonly name: string;
  readonly hexSize: number; // render circumradius
  readonly cells: readonly MapCell[];
  readonly units: readonly UnitPlacement[];
  readonly objective: ObjectiveDef;
}
