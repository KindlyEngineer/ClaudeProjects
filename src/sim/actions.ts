import { RULES } from "../data/rules";
import { unitType } from "../data/units";
import { resolveAttack, inRange, type AttackResult } from "./combat";
import { addEffect, hasEffect, moveCostAt } from "./effects";
import { climbCost } from "./elevation";
import { emit } from "./events";
import { transferSupply, type ResupplyResult } from "./logistics";
import { directionTo, hexDistance, hexKey, type Direction, type Hex } from "./hex";
import { isEligible } from "./turn";
import { isScouted } from "./vision";
import { canFire, canMove, livingUnits, type GameState, type UnitInstance } from "./state";

// The shared player-action API. Every actor — the player's UI, scripted v0
// scenarios, and the AIs — drives the sim through exactly these functions, so
// behaviour can't diverge between them. Each is a pure-ish mutation of state
// that validates first and reports why it failed. A unit may move once and take
// one main action (fire / resupply / fire mission / fortify) per turn, in its
// phase.

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
 *  the per-turn MP budget and from the fuel pool. The unit ends facing the hex
 *  face the caller specifies (`finalFacing`) — the player picks this after
 *  choosing a destination, and it sets which armour arc incoming fire strikes; if
 *  omitted (AI / scripted callers) it defaults to the direction of travel. */
export function moveUnit(state: GameState, unit: UnitInstance, path: readonly Hex[], finalFacing?: Direction): MoveResult {
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
    const mc = moveCostAt(state, step) + climbCost(state, prev, step); // terrain + effects + the climb
    if (!Number.isFinite(mc)) return { moved: false, cost: 0, reason: "impassable" };
    if (occupant(state, step, unit.id)) return { moved: false, cost: 0, reason: "occupied" };
    cost += mc;
    prev = step;
  }
  if (cost > movePoints(unit)) return { moved: false, cost: 0, reason: "out of move points" };
  if (cost > unit.fuel) return { moved: false, cost: 0, reason: "out of fuel" };

  const last = path[path.length - 1];
  const from = path.length >= 2 ? path[path.length - 2] : unit.hex;
  const start = unit.hex;
  unit.facing = finalFacing ?? directionTo(from, last);
  unit.hex = last;
  unit.fuel -= cost;
  unit.movedThisTurn = true;
  emit(state, { kind: "move", id: unit.id, side: unit.side, path: path.map((h) => ({ ...h })), from: start, facing: unit.facing });
  return { moved: true, cost };
}

/** Turn in place: set facing without leaving the hex. This is the unit's
 *  movement for the turn (it spends the move activation, not the main action),
 *  so an unmoved unit can re-front a threat — but not also relocate. */
export function faceUnit(state: GameState, unit: UnitInstance, facing: Direction): MoveResult {
  if (unit.movedThisTurn) return { moved: false, cost: 0, reason: "already moved" };
  if (!isEligible(state, unit)) return { moved: false, cost: 0, reason: "not its phase" };
  if (!canMove(unit)) return { moved: false, cost: 0, reason: "immobilised" };
  unit.facing = facing;
  unit.movedThisTurn = true;
  emit(state, { kind: "face", id: unit.id, side: unit.side, facing });
  return { moved: true, cost: 0 };
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
  const at = { ...target.hex }; // where the shot lands (before any later moves)
  const result = resolveAttack(state, attacker, weaponIndex, target);
  if (result.fired) {
    attacker.actedThisTurn = true;
    emit(state, {
      kind: "fire",
      id: attacker.id,
      side: attacker.side,
      targetId: target.id,
      weapon: unitType(attacker.typeId).weapons[weaponIndex].name,
      from: { ...attacker.hex },
      at,
      hit: result.hit,
      penetrated: result.penetrated,
      damage: result.damage,
      arc: result.arc,
      crit: result.crit,
      suppression: result.suppression,
      destroyed: result.destroyed,
    });
  }
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
  if (result.ok) {
    supplyUnit.actedThisTurn = true;
    emit(state, { kind: "resupply", id: supplyUnit.id, side: supplyUnit.side, targetId: target.id, ammo: result.ammoRestored, fuel: result.fuelRestored });
  }
  return result;
}

function fail(reason: string): ResupplyResult {
  return { ok: false, ammoRestored: 0, fuelRestored: 0, spent: 0, reason };
}

// ── Indirect-fire missions (the artillery's support verbs) ────────────────────

export type MissionKind = "suppress" | "smoke";

export interface MissionResult {
  ok: boolean;
  reason?: string;
  hexes: Hex[]; // the saturated area
  suppressed: number; // units rattled (suppress missions)
}

const NO_MISSION = (reason: string): MissionResult => ({ ok: false, reason, hexes: [], suppressed: 0 });

/** The weapon a unit would use for an area mission: its first indirect tube. */
export function missionWeaponIndex(unit: UnitInstance): number | null {
  const weapons = unitType(unit.typeId).weapons;
  for (let i = 0; i < weapons.length; i++) if (weapons[i].indirect) return i;
  return null;
}

/** May `unit` fire `kind` at `target` right now? Shared validation for the UI
 *  (greying/targeting) and the execution path. */
export function canFireMission(state: GameState, unit: UnitInstance, target: Hex, kind: MissionKind): { ok: boolean; reason?: string } {
  const wi = missionWeaponIndex(unit);
  if (wi === null) return { ok: false, reason: "no indirect weapon" };
  if (!isEligible(state, unit) || unit.actedThisTurn) return { ok: false, reason: "already acted" };
  if (!canFire(unit) || unit.dryTurns >= RULES.dryFireTurns) return { ok: false, reason: "cannot fire" };
  const weapon = unitType(unit.typeId).weapons[wi];
  if (unit.ammo[wi] < RULES.mission.ammoCost) return { ok: false, reason: "not enough ammo" };
  const d = hexDistance(unit.hex, target);
  if (d < weapon.rangeMin || d > weapon.rangeMax) return { ok: false, reason: "out of range" };
  if (!state.cells.has(hexKey(target))) return { ok: false, reason: "off map" };
  // Forward-observer rule: a SUPPRESSION mission engages troops, so somebody
  // must have eyes on the target hex. Smoke screens known ground — no eyes needed.
  if (kind === "suppress" && !isScouted(state, unit.side, target)) return { ok: false, reason: "target not observed" };
  return { ok: true };
}

/** Area hexes a mission saturates: the target + its ring (on-map only). */
export function missionArea(state: GameState, target: Hex): Hex[] {
  const out: Hex[] = [];
  for (const cell of state.map.cells) {
    if (hexDistance(cell.hex, target) <= RULES.mission.radius) out.push(cell.hex);
  }
  return out;
}

/** Fire an area mission (the unit's main action): SUPPRESS rattles every enemy
 *  in the area (no structure damage — saturation pins, aimed fire kills);
 *  SMOKE lays a sight-blocking screen across it. */
export function fireMission(state: GameState, unit: UnitInstance, target: Hex, kind: MissionKind): MissionResult {
  const gate = canFireMission(state, unit, target, kind);
  if (!gate.ok) return NO_MISSION(gate.reason ?? "invalid");
  const wi = missionWeaponIndex(unit)!;
  const weapon = unitType(unit.typeId).weapons[wi];
  const hexes = missionArea(state, target);
  const hexKeys = new Set(hexes.map(hexKey));

  const suppressedIds: number[] = [];
  if (kind === "suppress") {
    for (const e of livingUnits(state)) {
      if (e.side === unit.side || !hexKeys.has(hexKey(e.hex))) continue;
      e.suppression += weapon.suppression;
      if (e.suppression >= RULES.suppressionBreak && !e.crits.includes("shaken")) e.crits.push("shaken");
      suppressedIds.push(e.id);
    }
  } else {
    for (const h of hexes) addEffect(state, "smoke", h);
  }

  unit.ammo[wi] -= RULES.mission.ammoCost;
  unit.actedThisTurn = true;
  emit(state, { kind: "mission", id: unit.id, side: unit.side, mission: kind, at: { ...target }, hexes, suppressedIds });
  return { ok: true, hexes, suppressed: suppressedIds.length };
}

// ── Fortification (the engineers' support verb) ───────────────────────────────

/** May `unit` fortify `target` right now? Own hex or an adjacent one. */
export function canFortify(state: GameState, unit: UnitInstance, target: Hex): { ok: boolean; reason?: string } {
  if (unitType(unit.typeId).cls !== "engineer") return { ok: false, reason: "not an engineer" };
  if (!isEligible(state, unit) || unit.actedThisTurn) return { ok: false, reason: "already acted" };
  if (hexDistance(unit.hex, target) > 1) return { ok: false, reason: "not adjacent" };
  if (!state.cells.has(hexKey(target))) return { ok: false, reason: "off map" };
  if (!Number.isFinite(moveCostAt(state, target))) return { ok: false, reason: "impassable ground" };
  if (hasEffect(state, target, "fortification")) return { ok: false, reason: "already fortified" };
  return { ok: true };
}

/** Raise a fortification (cover for the occupant, slow going for everyone) on
 *  the engineer's own or an adjacent hex. Consumes the main action. */
export function fortifyHex(state: GameState, unit: UnitInstance, target: Hex): { ok: boolean; reason?: string } {
  const gate = canFortify(state, unit, target);
  if (!gate.ok) return gate;
  addEffect(state, "fortification", target);
  unit.actedThisTurn = true;
  emit(state, { kind: "build", id: unit.id, side: unit.side, at: { ...target }, effect: "fortification" });
  return { ok: true };
}
