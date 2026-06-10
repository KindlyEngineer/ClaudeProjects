import type { Side } from "../data/types";
import { sightBlockedAt } from "./effects";
import { heightClearsLine } from "./elevation";
import { hexDistance, hexLine, type Hex } from "./hex";
import { effectiveVision, livingUnits, type GameState, type UnitInstance } from "./state";

// Per-side vision (brief §2): the commander acts only on what its side can see —
// "no recon → blind and cautious." A side sees a hex if any living friendly unit
// is within its (sensors-crit-adjusted) sight range AND has a clear line of
// sight. Blocking terrain (woods/urban) and battlefield effects (smoke) break
// the line; in v1 a RIDGE cresting above the sightline blocks it too.

export function blocksSight(state: GameState, h: Hex): boolean {
  return sightBlockedAt(state, h);
}

/** Clear line of sight between two hexes — broken by intervening blocking
 *  terrain/smoke OR by ground rising above the eye-to-eye line (elevation). The
 *  endpoints themselves don't block. */
export function hasLineOfSight(state: GameState, from: Hex, to: Hex): boolean {
  const line = hexLine(from, to);
  for (let i = 1; i < line.length - 1; i++) {
    if (blocksSight(state, line[i])) return false;
  }
  return heightClearsLine(state, from, to);
}

export function canSee(state: GameState, observer: UnitInstance, target: Hex): boolean {
  return hexDistance(observer.hex, target) <= effectiveVision(observer) && hasLineOfSight(state, observer.hex, target);
}

/** Is `hex` inside one of `side`'s active recon-overflight footprints? (Air
 *  coverage lasts the turn it was called; inlined here — not imported from
 *  offmap.ts — to keep the module graph acyclic.) */
function airCovered(state: GameState, side: Side, hex: Hex): boolean {
  return state.airRecon.some(
    (a) => a.side === side && a.calledTurn === state.turn && hexDistance(a.center, hex) <= a.radius,
  );
}

/** Does `side` have eyes on `hex` — a friendly observer with line of sight, or
 *  an active recon overflight? Gates fog, scouting and ALL fires. */
export function isScouted(state: GameState, side: Side, hex: Hex): boolean {
  if (airCovered(state, side, hex)) return true;
  return livingUnits(state, side).some((o) => canSee(state, o, hex));
}

/** Enemy units `side` can currently see (ground observers or air coverage). */
export function visibleEnemies(state: GameState, side: Side): UnitInstance[] {
  const observers = livingUnits(state, side);
  return livingUnits(state)
    .filter((e) => e.side !== side)
    .filter((e) => airCovered(state, side, e.hex) || observers.some((o) => canSee(state, o, e.hex)));
}
