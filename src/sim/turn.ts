import { RULES } from "../data/rules";
import type { UnitClass } from "../data/types";
import { unitType } from "../data/units";
import { updatePostures } from "./assess";
import { expireEffects } from "./effects";
import { emit } from "./events";
import { expireAirRecon } from "./offmap";
import { updateBelief } from "./knowledge";
import { updateSupply } from "./logistics";
import { livingUnits, type GameState, type Phase, type UnitInstance } from "./state";

// Phased initiative (brief §3): a turn runs recon → fires → maneuver. Light
// elements (recon, infantry) act in the recon phase so they can scout before the
// heavy stuff commits; indirect fire shapes in the fires phase; armour and mechs
// commit in the maneuver phase. A unit may be held in RESERVE to skip its home
// phase and commit later in the maneuver phase.

export const PHASES: readonly Phase[] = ["recon", "fires", "maneuver"];

const HOME_PHASE: Record<UnitClass, Phase> = {
  recon: "recon",
  infantry: "recon",
  artillery: "fires",
  mech: "maneuver",
  armor: "maneuver",
  engineer: "maneuver",
  supply: "maneuver",
};

export function homePhase(u: UnitInstance): Phase {
  return HOME_PHASE[unitType(u.typeId).cls];
}

function phaseIndex(p: Phase): number {
  return PHASES.indexOf(p);
}

/** May this unit act in the current phase? Its home phase, unless reserved — a
 *  reserved unit waits and commits in the maneuver phase. */
export function isEligible(state: GameState, u: UnitInstance): boolean {
  if (u.structure <= 0) return false;
  const home = homePhase(u);
  if (u.reserved) return state.phase === "maneuver";
  return state.phase === home;
}

/** Turn upkeep: recompute supply, decay suppression (recovering shaken crews),
 *  and reset per-turn activation. Run at the start of every turn (incl. turn 1). */
export function beginTurn(state: GameState): void {
  state.phase = "recon";
  emit(state, { kind: "turn", n: state.turn });
  expireEffects(state); // smoke dissipates before anyone looks or moves
  expireAirRecon(state); // yesterday's overflight is yesterday's picture
  updateSupply(state);
  updateBelief(state, "blue"); // refresh each side's fog-limited picture
  updateBelief(state, "red");
  updatePostures(state); // re-assess the defender's posture from what it now knows
  for (const u of state.units) {
    if (u.structure <= 0) delete state.intents[u.id]; // no banners for the dead
  }
  for (const u of livingUnits(state)) {
    u.movedThisTurn = false;
    u.actedThisTurn = false;
    u.reserved = false; // a reserve commitment lasts one turn
    u.suppression = Math.max(0, u.suppression - RULES.suppressionDecayPerTurn);
    if (u.suppression < RULES.suppressionBreak) {
      const i = u.crits.indexOf("shaken");
      if (i >= 0) u.crits.splice(i, 1); // crew recovers once the pressure eases
    }
  }
}

/** Advance to the next phase; rolling off the last phase ends the turn and runs
 *  upkeep for the next one. Returns true if a new turn started. */
export function nextPhase(state: GameState): boolean {
  const i = phaseIndex(state.phase);
  if (i < PHASES.length - 1) {
    state.phase = PHASES[i + 1];
    emit(state, { kind: "phase", phase: state.phase });
    return false;
  }
  state.turn += 1;
  beginTurn(state);
  return true;
}
