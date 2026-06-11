import { RULES } from "../data/rules";
import type { Side } from "../data/types";
import { type GameState, type Sighting } from "./state";
import { isScouted, visibleEnemies } from "./vision";

// Fog-limited knowledge. The AI must never reason on ground truth — only on what
// its side currently sees plus a decaying memory of last-known enemy positions.
// updateBelief() refreshes that picture each turn: visible enemies become fresh
// sightings; ones out of sight are remembered (and eventually forgotten).

export function updateBelief(state: GameState, side: Side): void {
  const belief = state.belief[side];
  for (const s of belief.values()) s.visibleNow = false; // stale until re-sighted

  for (const e of visibleEnemies(state, side)) {
    belief.set(e.id, {
      id: e.id,
      typeId: e.typeId,
      side: e.side,
      hex: { q: e.hex.q, r: e.hex.r },
      facing: e.facing,
      structure: e.structure,
      suppression: e.suppression,
      crits: [...e.crits],
      lastSeenTurn: state.turn,
      visibleNow: true,
    });
  }

  // Forget stale sightings — the enemy has had time to move on. PHANTOMS
  // (negative ids — EW decoys, D15) are also blown the moment the believing
  // side actually gets eyes on the hex and finds nothing there.
  for (const [id, s] of belief) {
    if (state.turn - s.lastSeenTurn > RULES.commander.memoryTurns) belief.delete(id);
    else if (id < 0 && isScouted(state, side, s.hex)) belief.delete(id);
  }
}

/** Everything `side` believes about the enemy (fresh + remembered). */
export function believedEnemies(state: GameState, side: Side): Sighting[] {
  return [...state.belief[side].values()];
}

/** Only the enemies `side` can see right now — required to actually open fire. */
export function visibleSightings(state: GameState, side: Side): Sighting[] {
  return believedEnemies(state, side).filter((s) => s.visibleNow);
}
