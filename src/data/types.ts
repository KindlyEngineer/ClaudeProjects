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
  | "aa" // air defence: contests off-map strikes (M2.5)
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

/** The shared crit states (brief §2). A crit is a mission-kill, not a removal —
 *  a mobility-killed unit is a stranded problem, still on the board. Since M2.5
 *  these states are DERIVED from component damage (see ComponentDef). */
export type CritState = "mobility" | "weapon" | "sensors" | "shaken";

/** A unit COMPONENT (M2.5): the thing a penetrating crit actually breaks.
 *  Uniformity holds — every unit declares components; the resolution and the
 *  effect vocabulary are shared. `weapon` effects disable ONE specific mount. */
export interface ComponentDef {
  readonly id: string;
  readonly name: string;
  readonly effect: "mobility" | "sensors" | "crew" | "weapon";
  readonly weaponIndex?: number; // for effect "weapon": which mount dies
}

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
  readonly components: readonly ComponentDef[]; // what crits can break (M2.5)
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

/**
 * BAKED CONVENTION — map orientation. The sim assumes BLUE's home edge is the
 * minimum-q column and RED's the maximum-q column: supply lines trace to those
 * edges (`logistics.supplySources`) and the AI's advance/defence geometry keys
 * off them (`plan.ts`). Author maps with blue deploying west/low-q and red
 * east/high-q, or both will quietly misbehave.
 */
export interface MapDef {
  readonly name: string;
  readonly hexSize: number; // render circumradius
  readonly cells: readonly MapCell[];
  readonly units: readonly UnitPlacement[];
  readonly objective: ObjectiveDef;
  /** Commander skill per side in (0,1] — 1 = near-flawless, lower = more
   *  fallible (a designer-set difficulty). Defaults to 1 if omitted. */
  readonly commanderSkill?: { readonly blue?: number; readonly red?: number };
  /** Off-map asset budget per side for this battle (defaults to none). The
   *  operation Interlude may top these up from the stockpile. */
  readonly offmap?: { readonly blue?: OffMapBudget; readonly red?: OffMapBudget };
  /** The hexes a player may DEPLOY their composed support force into at battle
   *  outset (M2.6). Omitted → derived in prepareBattle (blue's home band when
   *  attacking, the objective's neighbourhood when defending). */
  readonly deployZone?: readonly Hex[];
}

/** Side-level off-map calls available in a battle (air support, M1). */
export interface OffMapBudget {
  readonly strike?: number;
  readonly recon?: number;
}

// ── Operations (the linked campaign, M1) ────────────────────────────────────

/** One battle in an operation: the scenario plus what completing it awards. */
export interface OperationBattleDef {
  readonly mapId: string; // resolved via data/maps registry
  readonly title: string;
  readonly briefing: string;
  /** Stockpile award on completion; winning earns `win`, losing only `loss`
   *  (failure-forward: defeats are carried, not retried). */
  readonly award: { readonly win: Partial<Stockpile>; readonly loss: Partial<Stockpile> };
}

/** The operation's finite resource pool the player allocates in the Interlude.
 *  Whatever the player does NOT spend on their own echelon is the depot the
 *  commander draws on to refit its mechs — provision, never task. */
export interface Stockpile {
  readonly ammo: number; // rounds
  readonly fuel: number; // movement-point fuel
  readonly repair: number; // structure points (also clears crits, at a cost)
  readonly strikes: number; // air strike sorties (assignable per battle)
  readonly recon: number; // overflight sorties
  readonly credits: number; // requisitions: replacement vehicles / a NEW mech
}

export interface OperationDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly battles: readonly OperationBattleDef[];
  readonly initialStockpile: Stockpile;
  /** Requisition price for a NEW mech (credits) — a fully new named entity,
   *  commander-chosen chassis, never a resurrection. */
  readonly mechPrice: number;
  /** The support units the player may BUY and field (M2.6 force composition):
   *  each type with its credit price. Mechs are never here — they're the
   *  commander's. */
  readonly supportCatalog: ReadonlyArray<{ readonly type: string; readonly price: number }>;
  /** Hard cap on the number of player-controlled support units in the force. */
  readonly supportCap: number;
}
