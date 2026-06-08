import { unitType } from "../data/units";
import { canAttack } from "../sim/actions";
import { hexDistance } from "../sim/hex";
import { reachable, type ReachNode } from "../sim/pathing";
import { canFire, canMove, livingUnits, type GameState, type UnitInstance } from "../sim/state";
import { isEligible } from "../sim/turn";

// Pure interaction logic for the interactive UI — what the player may select and
// command right now, derived solely from sim state. No DOM, no THREE, so it's
// unit-testable. The DOM/Three controller (ui/interactive.ts) is a thin shell
// over these and the shared action API; it never reasons about rules itself.
//
// The brief's invariant lives here: the player may order ONLY their own units
// (controller === "player"); the mechs and the enemy are AI and can be inspected
// but never commanded. isPlayerControllable is the single gate for that.

export function isPlayerControllable(unit: UnitInstance): boolean {
  return unit.controller === "player";
}

/** Can this unit still do anything this activation — move or take its main
 *  action? (A unit that has both moved and acted is spent.) */
export function hasActivationLeft(unit: UnitInstance): boolean {
  return !unit.movedThisTurn || !unit.actedThisTurn;
}

/** "Ready" = the player can issue this unit an order right now: it's theirs, it's
 *  this unit's phase, and it hasn't spent its activation. Drives the bright/greyed
 *  state of cards and board markers. */
export function readyToOrder(state: GameState, unit: UnitInstance): boolean {
  return isPlayerControllable(unit) && isEligible(state, unit) && hasActivationLeft(unit);
}

/** The hexes this unit could still move to this activation (empty if it can't —
 *  already moved, immobilised, or not its phase). Excludes its current hex. */
export function moveOptions(state: GameState, unit: UnitInstance): Map<string, ReachNode> {
  const out = new Map<string, ReachNode>();
  if (!readyToOrder(state, unit) || unit.movedThisTurn || !canMove(unit)) return out;
  for (const [k, node] of reachable(state, unit)) if (node.prev !== null) out.set(k, node);
  return out;
}

/** Visible enemies this unit can fire on right now → enemyId ⇒ the weapon index
 *  to use (the first weapon that can engage it). Empty if it can't shoot. */
export function attackOptions(state: GameState, unit: UnitInstance): Map<number, number> {
  const out = new Map<number, number>();
  if (!readyToOrder(state, unit) || unit.actedThisTurn || !canFire(unit)) return out;
  const enemySide = unit.side === "blue" ? "red" : "blue";
  const weapons = unitType(unit.typeId).weapons;
  for (const e of livingUnits(state, enemySide)) {
    for (let wi = 0; wi < weapons.length; wi++) {
      if (canAttack(state, unit, wi, e)) {
        out.set(e.id, wi);
        break;
      }
    }
  }
  return out;
}

function needsSupply(u: UnitInstance): boolean {
  const t = unitType(u.typeId);
  return u.fuel < t.fuelMax || u.ammo.some((a, i) => a < t.weapons[i].ammoMax);
}

/** Adjacent friendly units this supply unit could resupply right now. */
export function resupplyOptions(state: GameState, unit: UnitInstance): Set<number> {
  const out = new Set<number>();
  if (!readyToOrder(state, unit) || unit.actedThisTurn) return out;
  if (unitType(unit.typeId).cls !== "supply" || unit.supply <= 0) return out;
  for (const t of livingUnits(state, unit.side)) {
    if (t.id !== unit.id && hexDistance(unit.hex, t.hex) === 1 && needsSupply(t)) out.add(t.id);
  }
  return out;
}

export interface CardModel {
  id: number;
  side: "blue" | "red";
  abbr: string;
  name: string;
  controllable: boolean; // player-ordered (vs AI mech / enemy)
  ready: boolean; // actionable this phase → bright; else greyed
  structureFrac: number;
  fuelFrac: number;
  ammoFrac: number;
  inSupply: boolean;
  shaken: boolean;
  intent: string | null; // AI mech's current commander intent, if any
}

/** Display model for one unit's info card (pure derivation of sim state). */
export function cardModel(state: GameState, unit: UnitInstance): CardModel {
  const t = unitType(unit.typeId);
  const ammoMax = t.weapons.reduce((s, w) => s + w.ammoMax, 0);
  const ammoNow = unit.ammo.reduce((s, a) => s + a, 0);
  return {
    id: unit.id,
    side: unit.side,
    abbr: t.cls.charAt(0).toUpperCase(),
    name: t.name,
    controllable: isPlayerControllable(unit),
    ready: readyToOrder(state, unit),
    structureFrac: Math.max(0, unit.structure / t.structure),
    fuelFrac: t.fuelMax ? unit.fuel / t.fuelMax : 1,
    ammoFrac: ammoMax ? ammoNow / ammoMax : 1,
    inSupply: unit.inSupply,
    shaken: unit.crits.includes("shaken"),
    intent: t.cls === "mech" ? (state.intents[unit.id] ?? null) : null,
  };
}

/** The cards to show: the player's whole force (their side), ordered support
 *  first (the units they actually command) then the AI mechs. Enemy units aren't
 *  listed — the player only knows them through what's on the board (fog of war). */
export function forceCards(state: GameState, side: "blue" | "red"): CardModel[] {
  return livingUnits(state, side)
    .map((u) => cardModel(state, u))
    .sort((a, b) => Number(b.controllable) - Number(a.controllable) || a.id - b.id);
}
