import { RULES } from "../data/rules";
import { terrain } from "../data/terrain";
import { unitType } from "../data/units";
import { resolveAttack, inRange, type AttackResult } from "./combat";
import { transferSupply, type ResupplyResult } from "./logistics";
import { directionTo, hexDistance, hexKey, type Hex } from "./hex";
import { isEligible } from "./turn";
import { isScouted } from "./vision";
import { canFire, canMove, type GameState, type UnitInstance } from "./state";

// The shared player-action API. Every actor — the player's UI, scripted v0
// scenarios, and the AIs in later slices — drives the sim through exactly these
// functions, so behaviour can't diverge between them. Each is a pure-ish
// mutation of state that validates first and reports why it failed. A unit may
// move once and take one main action (fire or resupply) per turn, in its phase.

export interface MoveResult {
  moved: boolean;
  cost: number;
  reason?: string;
}

function occupant(state: GameState, h: Hex, exceptId: number): UnitInstance | undefined {
  return state.units.find((u) => u.structure > 0 && u.id !== exceptId && u.hex.q === h.q && u.hex.r === h.r);
}

/** Movement-point budget this turn (halved while cut off from supply). */
export function movePoints(unit: UnitInstance): number {
  const base = unitType(unit.typeId).move;
  return unit.dryTurns >= RULES.dryMoveTurns ? Math.floor(base / 2) : base;
}

/** Move along a contiguous path of adjacent hexes, paying terrain move-cost from
 *  the per-turn MP budget and from the fuel pool. Updates facing to the last step. */
export function moveUnit(state: GameState, unit: UnitInstance, path: readonly Hex[]): MoveResult {
  if (unit.movedThisTurn) return { moved: false, cost: 0, reason: "already moved" };
  if (!isEligible(state, unit)) return { moved: false, cost: 0, reason: "not its phase" };
  if (!canMove(unit)) return { moved: false, cost: 0, reason: "immobilised" };
  if (path.length === 0) return { moved: false, cost: 0, reason: "empty path" };

  let prev = unit.hex;
  let cost = 0;
  for (const step of path) {
    if (hexDistance(prev, step) !== 1) return { moved: false, cost: 0, reason: "non-adjacent step" };
    const cell = state.cells.get(hexKey(step));
    if (!cell) return { moved: false, cost: 0, reason: "off map" };
    const mc = terrain(cell.terrain).moveCost;
    if (!Number.isFinite(mc)) return { moved: false, cost: 0, reason: "impassable" };
    if (occupant(state, step, unit.id)) return { moved: false, cost: 0, reason: "occupied" };
    cost += mc;
    prev = step;
  }
  if (cost > movePoints(unit)) return { moved: false, cost: 0, reason: "out of move points" };
  if (cost > unit.fuel) return { moved: false, cost: 0, reason: "out of fuel" };

  const last = path[path.length - 1];
  const from = path.length >= 2 ? path[path.length - 2] : unit.hex;
  unit.facing = directionTo(from, last);
  unit.hex = last;
  unit.fuel -= cost;
  unit.movedThisTurn = true;
  return { moved: true, cost };
}

const NO_FIRE: AttackResult = {
  fired: false,
  hit: false,
  arc: null,
  penetrated: false,
  damage: 0,
  destroyed: false,
  crit: null,
  suppression: 0,
};

/** Whether `attacker` is allowed to fire `weaponIndex` at `target` right now. */
export function canAttack(state: GameState, attacker: UnitInstance, weaponIndex: number, target: UnitInstance): boolean {
  if (!isEligible(state, attacker) || attacker.actedThisTurn) return false;
  if (!canFire(attacker) || attacker.dryTurns >= RULES.dryFireTurns) return false;
  if (target.structure <= 0 || target.side === attacker.side) return false;
  // Forward-observer rule: a side can only engage what it can SEE. This is what
  // makes recon load-bearing — including for indirect fire (you can't shell an
  // enemy nobody has eyes on).
  if (!isScouted(state, attacker.side, target.hex)) return false;
  const weapon = unitType(attacker.typeId).weapons[weaponIndex];
  if (!weapon || attacker.ammo[weaponIndex] <= 0) return false;
  return inRange(attacker, weapon, target);
}

/** Fire one of the attacker's weapons at a target (consumes its main action). */
export function attackUnit(
  state: GameState,
  attacker: UnitInstance,
  weaponIndex: number,
  target: UnitInstance,
): AttackResult {
  if (!canAttack(state, attacker, weaponIndex, target)) return NO_FIRE;
  const result = resolveAttack(state, attacker, weaponIndex, target);
  if (result.fired) attacker.actedThisTurn = true;
  return result;
}

/** Resupply an adjacent friendly unit from a supply vehicle (its main action). */
export function resupplyUnit(state: GameState, supplyUnit: UnitInstance, target: UnitInstance): ResupplyResult {
  if (unitType(supplyUnit.typeId).cls !== "supply") return fail("not a supply unit");
  if (supplyUnit.actedThisTurn) return fail("already acted");
  if (!isEligible(state, supplyUnit)) return fail("not its phase");
  if (supplyUnit.supply <= 0) return fail("empty");
  if (target.id === supplyUnit.id || target.side !== supplyUnit.side || target.structure <= 0)
    return fail("invalid target");
  if (hexDistance(supplyUnit.hex, target.hex) !== 1) return fail("not adjacent");

  const result = transferSupply(supplyUnit, target);
  if (result.ok) supplyUnit.actedThisTurn = true;
  return result;
}

function fail(reason: string): ResupplyResult {
  return { ok: false, ammoRestored: 0, fuelRestored: 0, spent: 0, reason };
}
