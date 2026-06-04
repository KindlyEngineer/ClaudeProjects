import { terrain } from "../data/terrain";
import { attackUnit, canAttack, moveUnit, movePoints } from "./actions";
import { hexDistance, hexKey, neighbors, type Hex } from "./hex";
import { livingUnits, type GameState, type UnitInstance } from "./state";

// Small shared tactical helpers used by the scripted support policies and the
// demo. They only drive the sim through the public action API; the real mech AI
// lives in commander.ts (this is for the player-side / scripted units).

export function passableUnoccupied(state: GameState, h: Hex, moverId: number): boolean {
  const cell = state.cells.get(hexKey(h));
  if (!cell || !Number.isFinite(terrain(cell.terrain).moveCost)) return false;
  return !livingUnits(state).some((u) => u.id !== moverId && u.hex.q === h.q && u.hex.r === h.r);
}

/** Greedily step toward `target` over open hexes, within MP/fuel budget. */
export function stepToward(state: GameState, unit: UnitInstance, target: Hex, maxSteps: number): void {
  const budget = Math.min(maxSteps, movePoints(unit), Math.floor(unit.fuel));
  const path: Hex[] = [];
  let cur = unit.hex;
  for (let i = 0; i < budget; i++) {
    let best: Hex | undefined;
    let bestD = hexDistance(cur, target);
    for (const n of neighbors(cur)) {
      if (!passableUnoccupied(state, n, unit.id)) continue;
      const d = hexDistance(n, target);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (!best) break;
    path.push(best);
    cur = best;
  }
  if (path.length) moveUnit(state, unit, path);
}

/** Fire weapon 0 at the nearest enemy this unit can legally engage. */
export function fireBest(state: GameState, unit: UnitInstance): void {
  let target: UnitInstance | undefined;
  let bestD = Infinity;
  for (const e of livingUnits(state)) {
    if (e.side === unit.side || !canAttack(state, unit, 0, e)) continue;
    const d = hexDistance(unit.hex, e.hex);
    if (d < bestD) {
      bestD = d;
      target = e;
    }
  }
  if (target) attackUnit(state, unit, 0, target);
}

export function nearestEnemyHex(state: GameState, unit: UnitInstance): Hex | undefined {
  let best: Hex | undefined;
  let bestD = Infinity;
  for (const e of livingUnits(state)) {
    if (e.side === unit.side) continue;
    const d = hexDistance(unit.hex, e.hex);
    if (d < bestD) {
      bestD = d;
      best = e.hex;
    }
  }
  return best;
}
