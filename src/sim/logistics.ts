import { terrain } from "../data/terrain";
import type { Side } from "../data/types";
import { unitType } from "../data/units";
import { hexKey, neighbors, type Hex } from "./hex";
import { livingUnits, type GameState, type UnitInstance } from "./state";

// Tactical logistics on the battlefield (brief §2): finite ammo + fuel, adjacent
// resupply, and supply-line tracing. A unit that cannot trace a path back to a
// supply source (its home edge or a friendly supply unit) goes "dry" — first it
// can't be resupplied, then escalating move/fire penalties. Map control is about
// supply geometry, not just standing on the objective.

/** Passable for a supply trace: on the map, traversable terrain, and not sealed
 *  off by a living ENEMY unit (enemies cut the line; friendlies don't). */
function traceable(state: GameState, h: Hex, side: Side): boolean {
  const cell = state.cells.get(hexKey(h));
  if (!cell) return false;
  if (!Number.isFinite(terrain(cell.terrain).moveCost)) return false;
  const occupant = livingUnits(state).find((u) => u.hex.q === h.q && u.hex.r === h.r);
  return !occupant || occupant.side === side;
}

/** Supply sources for a side: its home board edge plus its living supply units
 *  (forward depots project the network). Home edge = the side's starting flank
 *  (blue = min q column, red = max q column). */
export function supplySources(state: GameState, side: Side): Hex[] {
  let minQ = Infinity;
  let maxQ = -Infinity;
  for (const cell of state.map.cells) {
    if (cell.hex.q < minQ) minQ = cell.hex.q;
    if (cell.hex.q > maxQ) maxQ = cell.hex.q;
  }
  const edgeQ = side === "blue" ? minQ : maxQ;
  const sources: Hex[] = [];
  for (const cell of state.map.cells) {
    if (cell.hex.q === edgeQ && Number.isFinite(terrain(cell.terrain).moveCost)) sources.push(cell.hex);
  }
  for (const u of livingUnits(state, side)) {
    if (unitType(u.typeId).cls === "supply") sources.push(u.hex);
  }
  return sources;
}

/** The set of hexes a side can trace supply to (BFS from its sources). */
export function suppliedHexes(state: GameState, side: Side): Set<string> {
  const seen = new Set<string>();
  const queue: Hex[] = [];
  for (const s of supplySources(state, side)) {
    const k = hexKey(s);
    if (!seen.has(k)) {
      seen.add(k);
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const h = queue.shift()!;
    for (const n of neighbors(h)) {
      const k = hexKey(n);
      if (seen.has(k)) continue;
      if (!traceable(state, n, side)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return seen;
}

/** Recompute every unit's supply status: in-supply resets the dry counter,
 *  out-of-supply increments it. Called at the start of each turn. */
export function updateSupply(state: GameState): void {
  for (const side of ["blue", "red"] as const) {
    const supplied = suppliedHexes(state, side);
    for (const u of livingUnits(state, side)) {
      u.inSupply = supplied.has(hexKey(u.hex));
      u.dryTurns = u.inSupply ? 0 : u.dryTurns + 1;
    }
  }
}

/** Does `unit` have an ammo or fuel deficit worth a resupply? Any missing ammo
 *  counts; `fuelFraction` sets how low fuel must run (1 = any deficit — the
 *  UI's "is this a legal, useful action"; the AI passes 0.6 so it doesn't chase
 *  one-point top-ups). The ONE definition shared by the UI, the AI and the
 *  scripted policies, so they never disagree about who is needy. */
export function needsSupply(unit: UnitInstance, fuelFraction = 1): boolean {
  const t = unitType(unit.typeId);
  return unit.fuel < t.fuelMax * fuelFraction || unit.ammo.some((a, i) => a < t.weapons[i].ammoMax);
}

export interface ResupplyResult {
  ok: boolean;
  ammoRestored: number;
  fuelRestored: number;
  spent: number;
  reason?: string;
}

/** Transfer from a supply unit's finite budget into an adjacent friendly unit,
 *  refilling ammo first (more critical), then fuel. Supply never goes negative. */
export function transferSupply(supplyUnit: UnitInstance, target: UnitInstance): ResupplyResult {
  let budget = supplyUnit.supply;
  let ammoRestored = 0;
  let fuelRestored = 0;

  // Ammo is discrete whole rounds — transfer integers only, so a fractional
  // supply budget (fuel is continuous since elevation: climb costs are
  // fractional) can never leak a fractional round into the ammo count (which
  // would later underflow past zero on the next shot).
  const maxAmmo = unitType(target.typeId).weapons.map((w) => w.ammoMax);
  for (let i = 0; i < target.ammo.length && budget >= 1; i++) {
    const need = maxAmmo[i] - target.ammo[i];
    const give = Math.min(need, Math.floor(budget));
    if (give <= 0) continue;
    target.ammo[i] += give;
    budget -= give;
    ammoRestored += give;
  }
  const fuelNeed = unitType(target.typeId).fuelMax - target.fuel;
  const fuelGive = Math.min(fuelNeed, budget);
  target.fuel += fuelGive;
  budget -= fuelGive;
  fuelRestored = fuelGive;

  const spent = supplyUnit.supply - budget;
  supplyUnit.supply = budget;
  return { ok: spent > 0, ammoRestored, fuelRestored, spent };
}
