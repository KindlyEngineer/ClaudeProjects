import { unitType } from "../data/units";
import { resupplyUnit } from "./actions";
import { fireBest, stepToward } from "./aiutil";
import { commandMechs } from "./commander";
import { hexDistance, type Hex } from "./hex";
import { evaluateOutcome } from "./objective";
import { livingUnits, type GameState, type UnitInstance } from "./state";
import { beginTurn, nextPhase } from "./turn";

// The match runner — the headless harness that plays a whole battle to a result.
// Mechs are ALWAYS the commander AI (both sides); each side's SUPPORT effort is
// supplied as a policy (the player's plan, none, or a defender). Policies are
// called once per phase and rely on the action API's phase guards to act only
// the right units. This is what the core-proof test and self-play drive.

export type SupportPolicy = (state: GameState) => void;

export interface MatchResult {
  outcome: "blue" | "red";
  turns: number;
}

export function runMatch(state: GameState, blue: SupportPolicy, red: SupportPolicy): MatchResult {
  beginTurn(state);
  const maxSteps = (state.objective.turnLimit + 2) * 3;
  for (let step = 0; step < maxSteps; step++) {
    const atStart = evaluateOutcome(state); // clock / attrition
    if (atStart !== "ongoing") {
      state.outcome = atStart;
      return { outcome: atStart, turns: state.turn };
    }
    blue(state);
    red(state);
    commandMechs(state, "blue");
    commandMechs(state, "red");
    const afterActing = evaluateOutcome(state); // immediate seize
    if (afterActing !== "ongoing") {
      state.outcome = afterActing;
      return { outcome: afterActing, turns: state.turn };
    }
    nextPhase(state);
  }
  state.outcome = "red"; // safety: clock expired, defender holds
  return { outcome: "red", turns: state.turn };
}

// ── Support policies ─────────────────────────────────────────────────────────

function objectiveHex(state: GameState): Hex {
  return state.objective.zone[0] ?? { q: 0, r: 0 };
}

function nearestMech(state: GameState, side: "blue" | "red", from: Hex): UnitInstance | undefined {
  let best: UnitInstance | undefined;
  let bestD = Infinity;
  for (const m of livingUnits(state, side)) {
    if (unitType(m.typeId).cls !== "mech") continue;
    const d = hexDistance(from, m.hex);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

function needsSupply(u: UnitInstance): boolean {
  const t = unitType(u.typeId);
  return u.fuel < t.fuelMax * 0.6 || u.ammo.some((a, i) => a < t.weapons[i].ammoMax);
}

/** The player does nothing — the mechs fight unsupported. */
export const noSupport: SupportPolicy = () => {};

/** The defined player support plan: recon scouts the approach, artillery
 *  suppresses the revealed defenders, supply keeps the mech fed, armour/infantry
 *  screen the advance. (Brief §4 criterion 1: resupply + suppressive fire + recon.) */
export const playerSupport: SupportPolicy = (state) => {
  const obj = objectiveHex(state);
  for (const u of livingUnits(state, "blue")) {
    const cls = unitType(u.typeId).cls;
    if (cls === "mech") continue; // the commander drives mechs
    if (cls === "supply") {
      const needy = livingUnits(state, "blue").find(
        (t) => t.id !== u.id && hexDistance(u.hex, t.hex) === 1 && needsSupply(t),
      );
      if (needy) resupplyUnit(state, u, needy);
      else {
        const mech = nearestMech(state, "blue", u.hex);
        if (mech) stepToward(state, u, mech.hex, 3); // follow the advance to stay close
      }
      continue;
    }
    if (cls === "artillery") {
      fireBest(state, u); // shell whatever recon has revealed (forward-observer rule)
      continue;
    }
    if (cls === "recon") {
      if (hexDistance(u.hex, obj) > 9) stepToward(state, u, obj, 3); // scout from standoff
      fireBest(state, u);
      continue;
    }
    // infantry / armour / engineer: advance and screen, engaging what they see.
    stepToward(state, u, obj, 3);
    fireBest(state, u);
  }
};

/** The red defender's support: hold position and fire at anything in sight. */
export const redDefense: SupportPolicy = (state) => {
  for (const u of livingUnits(state, "red")) {
    if (unitType(u.typeId).cls === "mech") continue; // commander drives the red mech
    fireBest(state, u);
  }
};
