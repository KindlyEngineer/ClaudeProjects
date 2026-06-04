import type { MapCell, MapDef, ObjectiveDef, Side } from "../data/types";
import { terrain } from "../data/terrain";
import { unitType } from "../data/units";
import { hexKey, type Direction, type Hex } from "./hex";

// Runtime game state. Plain, serializable data advanced by pure functions in
// later slices (combat, logistics, turns, AI). Rendering only ever *reads* this.
// Deterministic: the rng state and a roll log live here so a match reproduces
// exactly from a seed.

export interface UnitInstance {
  id: number;
  typeId: string;
  side: Side;
  hex: Hex;
  facing: Direction;
  structure: number; // remaining; 0 = destroyed
  ammo: number[]; // per weapon index, parallel to UnitType.weapons
  fuel: number; // remaining movement-point fuel
  suppression: number; // 0..N morale pressure
  crits: string[]; // active CritState ids
  supply: number; // supply units: remaining resupply budget (else 0)
  hasActed: boolean; // consumed its action this phase
}

export type Phase = "recon" | "fires" | "maneuver";

export interface GameState {
  map: MapDef;
  cells: Map<string, MapCell>; // hexKey → cell, for O(1) terrain/elevation lookup
  units: UnitInstance[];
  turn: number;
  phase: Phase;
  objective: ObjectiveDef;
  outcome: "ongoing" | "blue" | "red"; // who has won, or still playing
  seed: number;
  rngState: number; // advanced by the dice roller (slice 2)
  rollLog: RollRecord[];
}

/** Every random draw is logged for the headless harness (brief §3). */
export interface RollRecord {
  turn: number;
  kind: string; // "to-hit", "crit", …
  value: number; // the [0,1) draw
  detail?: string;
}

let nextId = 1;

/** Construct a fresh game from a map definition and a seed. */
export function createGame(map: MapDef, seed: number): GameState {
  const cells = new Map<string, MapCell>();
  for (const cell of map.cells) cells.set(hexKey(cell.hex), cell);

  const units: UnitInstance[] = map.units.map((p) => {
    const t = unitType(p.type);
    return {
      id: nextId++,
      typeId: t.id,
      side: p.side,
      hex: p.hex,
      facing: p.facing,
      structure: t.structure,
      ammo: t.weapons.map((w) => w.ammoMax),
      fuel: t.fuelMax,
      suppression: 0,
      crits: [],
      supply: t.supplyCapacity ?? 0,
      hasActed: false,
    };
  });

  return {
    map,
    cells,
    units,
    turn: 1,
    phase: "recon",
    objective: map.objective,
    outcome: "ongoing",
    seed,
    rngState: seed >>> 0,
    rollLog: [],
  };
}

export function cellAt(state: GameState, h: Hex): MapCell | undefined {
  return state.cells.get(hexKey(h));
}

export function elevationAt(state: GameState, h: Hex): number {
  return cellAt(state, h)?.elevation ?? 0;
}

export function terrainAt(state: GameState, h: Hex) {
  const cell = cellAt(state, h);
  return cell ? terrain(cell.terrain) : undefined;
}

export function unitAt(state: GameState, h: Hex): UnitInstance | undefined {
  return state.units.find((u) => u.structure > 0 && u.hex.q === h.q && u.hex.r === h.r);
}

export function livingUnits(state: GameState, side?: Side): UnitInstance[] {
  return state.units.filter((u) => u.structure > 0 && (side === undefined || u.side === side));
}

// ── Unit status (crit effects) — read by movement, firing and the AI later. ──
export function isDestroyed(u: UnitInstance): boolean {
  return u.structure <= 0;
}
export function hasCrit(u: UnitInstance, c: string): boolean {
  return u.crits.includes(c);
}
/** A mobility-killed (or destroyed) unit cannot move. */
export function canMove(u: UnitInstance): boolean {
  return !isDestroyed(u) && !hasCrit(u, "mobility");
}
/** A weapon-killed (or destroyed) unit cannot fire. */
export function canFire(u: UnitInstance): boolean {
  return !isDestroyed(u) && !hasCrit(u, "weapon");
}
/** Sensors crit halves sight range. */
export function effectiveVision(u: UnitInstance): number {
  const base = unitType(u.typeId).vision;
  return hasCrit(u, "sensors") ? Math.max(1, Math.floor(base / 2)) : base;
}
