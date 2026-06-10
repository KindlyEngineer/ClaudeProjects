import { RULES } from "../data/rules";
import { hexLine, type Hex } from "./hex";
import { elevationAt, type GameState } from "./state";

// Mechanical elevation (v1): the continuous heightmap stops being decoration.
// High ground SEES over low obstacles and is harder to see past; firing DOWN a
// slope is easier; CLIMBING costs movement. All read the same per-hex elevation
// the render draws, so what you see is what you fight on. Pure + deterministic;
// on flat ground (every test map) every function is a no-op.

/** Does the GROUND stay clear of the eye-to-eye sightline from `from` to `to`?
 *  (Terrain/smoke blocking is handled separately in vision.) A hill between two
 *  units blocks the line if its crest rises above the interpolated sightline. */
export function heightClearsLine(state: GameState, from: Hex, to: Hex): boolean {
  const line = hexLine(from, to);
  const n = line.length - 1;
  if (n <= 1) return true; // adjacent / same hex — nothing in between
  const eye = RULES.elevation.eyeHeight;
  const a = elevationAt(state, from) + eye;
  const b = elevationAt(state, to) + eye;
  for (let i = 1; i < n; i++) {
    const sight = a + (b - a) * (i / n);
    if (elevationAt(state, line[i]) > sight + RULES.elevation.losClearance) return false;
  }
  return true;
}

/** Direct-fire to-hit bonus for shooting DOWN at a lower target (0 uphill). */
export function heightHitBonus(state: GameState, attacker: Hex, target: Hex): number {
  const d = elevationAt(state, attacker) - elevationAt(state, target);
  if (d <= 0) return 0;
  return Math.min(d * RULES.elevation.hitBonusPerLevel, RULES.elevation.hitBonusMax);
}

/** Extra movement cost to CLIMB from `from` into `to` (0 when level or downhill). */
export function climbCost(state: GameState, from: Hex, to: Hex): number {
  const d = elevationAt(state, to) - elevationAt(state, from);
  return d > 0 ? d * RULES.elevation.climbCostPerLevel : 0;
}
