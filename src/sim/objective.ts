import { unitType } from "../data/units";
import { hexKey } from "./hex";
import { livingUnits, type GameState } from "./state";

// Objective + win/loss evaluation. v0 ships the SEIZE objective: the attacker
// (blue) wins by getting its main effort — a mech — onto the objective zone by
// the turn limit. Loss (resolved with the owner) is attrition OR the clock:
// blue loses if it has no mechs left, no support units left, or fails to seize
// in time.

const mechs = (state: GameState, side: "blue" | "red") =>
  livingUnits(state, side).filter((u) => unitType(u.typeId).cls === "mech");
const support = (state: GameState, side: "blue" | "red") =>
  livingUnits(state, side).filter((u) => unitType(u.typeId).cls !== "mech");

/** Has the attacker put a mech onto the objective zone (taken it)? */
export function attackerHoldsZone(state: GameState): boolean {
  const zone = new Set(state.objective.zone.map(hexKey));
  return mechs(state, state.objective.attacker).some((m) => zone.has(hexKey(m.hex)));
}

/** Current match outcome: "blue" / "red" winner, or "ongoing". */
export function evaluateOutcome(state: GameState): "ongoing" | "blue" | "red" {
  const attacker = state.objective.attacker; // "blue" in v0
  const defender = attacker === "blue" ? "red" : "blue";

  if (attackerHoldsZone(state)) return attacker;
  // Attrition: the attacker is the player's side — losing all mechs or all
  // support ends the effort.
  if (mechs(state, attacker).length === 0 || support(state, attacker).length === 0) return defender;
  // A wiped-out defence can't contest anything — the attacker wins at once
  // (rather than walking to the zone against nobody until the clock decides).
  if (livingUnits(state, defender).length === 0) return attacker;
  // The clock: take it by the turn limit, or the defender holds.
  if (state.turn > state.objective.turnLimit) return defender;
  return "ongoing";
}
