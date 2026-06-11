import type { Controller, MapCell, MapDef, ObjectiveDef, Side } from "../data/types";
import { terrain } from "../data/terrain";
import { unitType } from "../data/units";
import type { BattlefieldEffect } from "./effects";
import type { GameEvent } from "./events";
import { hexKey, type Direction, type Hex } from "./hex";

// Runtime game state. Plain, serializable data advanced by pure functions in
// later slices (combat, logistics, turns, AI). Rendering only ever *reads* this.
// Deterministic: the rng state and a roll log live here so a match reproduces
// exactly from a seed.

export interface UnitInstance {
  id: number;
  typeId: string;
  side: Side;
  controller: Controller; // who issues this unit's orders (ai / player)
  callSign?: string; // the main effort's name — the entity you serve (mechs only)
  hex: Hex;
  facing: Direction;
  structure: number; // remaining; 0 = destroyed
  ammo: number[]; // per weapon index, parallel to UnitType.weapons
  fuel: number; // remaining movement-point fuel
  suppression: number; // 0..N morale pressure
  crits: string[]; // active CritState ids (derived from component damage)
  componentsLost: string[]; // ComponentDef ids knocked out (M2.5)
  supply: number; // supply units: remaining resupply budget (else 0)
  // Per-turn activation (reset each turn): a unit may move once and take one
  // main action (fire or resupply).
  movedThisTurn: boolean;
  actedThisTurn: boolean;
  reserved: boolean; // held out of its home phase to commit in maneuver
  // Logistics (recomputed each turn from supply-line tracing).
  inSupply: boolean;
  dryTurns: number; // consecutive turns cut off from supply
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
  events: GameEvent[]; // append-only what-happened stream (animation + combat log)
  effects: BattlefieldEffect[]; // smoke / fortifications standing on the ground
  intents: Record<number, string>; // mech id → the commander's current intent
  belief: { blue: Belief; red: Belief }; // fog-limited knowledge each side reasons on
  posture: { blue: PostureState; red: PostureState }; // operational posture per side
  skill: { blue: number; red: number }; // commander skill (0,1]; <1 = fallible
  offmap: { blue: { strike: number; recon: number }; red: { strike: number; recon: number } }; // air sorties left
  airRecon: AirReconCoverage[]; // active overflight footprints (this turn's eyes)
  deployZone: Hex[]; // where the player may place its force pre-battle (M2.6); [] if none
  deployPending: boolean; // true at battle outset until the player confirms deployment
}

/** A recon overflight's footprint: the calling side sees (and may engage) inside
 *  it for the remainder of the turn it was called. */
export interface AirReconCoverage {
  side: Side;
  center: Hex;
  radius: number;
  calledTurn: number;
}

/** Every random draw is logged for the headless harness (brief §3). */
export interface RollRecord {
  turn: number;
  kind: string; // "to-hit", "crit", …
  value: number; // the [0,1) draw
  detail?: string;
}

/** What a side believes about one enemy unit — its last-known state. Fresh while
 *  visible; otherwise remembered (and decayed) so the AI is never omniscient. */
export interface Sighting {
  id: number;
  typeId: string;
  side: Side;
  hex: Hex;
  facing: Direction;
  structure: number;
  suppression: number;
  crits: string[];
  lastSeenTurn: number;
  visibleNow: boolean; // currently in sight (required to actually fire on it)
}

/** Per-side belief: enemy id → last-known sighting. */
export type Belief = Map<number, Sighting>;

/** A side's current operational posture (set by the planner each turn, with
 *  hysteresis). "probe" = gain information; "counter" = perceived advantage,
 *  go aggressive; "hold" = defend prepared positions. */
export interface PostureState {
  // Defender: hold → probe → counter. Attacker: develop → assault.
  kind: "hold" | "probe" | "counter" | "develop" | "assault";
  since: number;
  targetId: number | null;
}

// Call signs for the autonomous main effort (assigned in placement order).
export const CALL_SIGNS = ["Vanguard", "Saber", "Reaper", "Warden", "Talon", "Ronin", "Halberd", "Cobra"] as const;

/** Display name: a mech's call sign (the entity you serve), else its type name. */
export function unitLabel(u: UnitInstance): string {
  return u.callSign ?? unitType(u.typeId).name;
}

let nextId = 1;

/** Construct a fresh game from a map definition and a seed. */
export function createGame(map: MapDef, seed: number): GameState {
  nextId = 1; // deterministic unit ids per game (id is used as a seeded-AI salt)
  const cells = new Map<string, MapCell>();
  for (const cell of map.cells) cells.set(hexKey(cell.hex), cell);

  const units: UnitInstance[] = map.units.map((p) => {
    const t = unitType(p.type);
    return {
      id: nextId++,
      typeId: t.id,
      side: p.side,
      controller: p.controller ?? "ai", // designer-set; defaults to AI-run
      hex: p.hex,
      facing: p.facing,
      structure: t.structure,
      ammo: t.weapons.map((w) => w.ammoMax),
      fuel: t.fuelMax,
      suppression: 0,
      crits: [],
      componentsLost: [],
      supply: t.supplyCapacity ?? 0,
      movedThisTurn: false,
      actedThisTurn: false,
      reserved: false,
      inSupply: true,
      dryTurns: 0,
    };
  });

  // Call signs for the main effort — the autonomous mechs the player serves get
  // names, not numbers. Deterministic (assignment order), per side.
  const counts: Record<Side, number> = { blue: 0, red: 0 };
  for (const u of units) {
    if (unitType(u.typeId).cls === "mech") u.callSign = CALL_SIGNS[counts[u.side]++ % CALL_SIGNS.length];
  }

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
    events: [],
    effects: [],
    intents: {},
    belief: { blue: new Map(), red: new Map() },
    posture: {
      blue: { kind: "hold", since: 1, targetId: null },
      red: { kind: "hold", since: 1, targetId: null },
    },
    skill: { blue: map.commanderSkill?.blue ?? 1, red: map.commanderSkill?.red ?? 1 },
    offmap: {
      blue: { strike: map.offmap?.blue?.strike ?? 0, recon: map.offmap?.blue?.recon ?? 0 },
      red: { strike: map.offmap?.red?.strike ?? 0, recon: map.offmap?.red?.recon ?? 0 },
    },
    airRecon: [],
    deployZone: (map.deployZone ?? []).map((h) => ({ ...h })),
    deployPending: false,
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
/** A weapon-killed, shaken (morale break), or destroyed unit cannot fire. A
 *  shaken crew recovers in upkeep once suppression eases — so suppressive fire
 *  temporarily takes a unit out of the fight. */
export function canFire(u: UnitInstance): boolean {
  return !isDestroyed(u) && !hasCrit(u, "weapon") && !hasCrit(u, "shaken");
}
/** Sensors crit halves sight range. */
export function effectiveVision(u: UnitInstance): number {
  const base = unitType(u.typeId).vision;
  return hasCrit(u, "sensors") ? Math.max(1, Math.floor(base / 2)) : base;
}
