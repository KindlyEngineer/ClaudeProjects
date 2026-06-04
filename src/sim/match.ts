import { unitType } from "../data/units";
import { commandForce } from "./ai";
import { attackUnit, canAttack, resupplyUnit } from "./actions";
import { fireBest, stepToward } from "./aiutil";
import { hexDistance, type Hex } from "./hex";
import { evaluateOutcome } from "./objective";
import { livingUnits, type GameState, type UnitInstance } from "./state";
import { beginTurn, nextPhase } from "./turn";

// The match runner — the headless harness that plays a whole battle to a result.
// Every AI-controlled unit (either side) is driven by the one force AI
// (commandForce); the player's units are driven by a supplied policy (the human
// stand-in). Policies act once per phase and rely on the action API's phase
// guards. This is what the core-proof test and AI-vs-AI self-play drive.

export type PlayerPolicy = (state: GameState) => void;

export interface MatchResult {
  outcome: "blue" | "red";
  turns: number;
}

export function runMatch(state: GameState, player: PlayerPolicy): MatchResult {
  beginTurn(state);
  const maxSteps = (state.objective.turnLimit + 2) * 3;
  for (let step = 0; step < maxSteps; step++) {
    const atStart = evaluateOutcome(state); // clock / attrition
    if (atStart !== "ongoing") {
      state.outcome = atStart;
      return { outcome: atStart, turns: state.turn };
    }
    player(state); // the player's (controller==="player") units
    commandForce(state, "blue"); // every AI-controlled unit, both sides
    commandForce(state, "red");
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

// ── Player policies (drive only controller==="player" units) ─────────────────

function objectiveHex(state: GameState): Hex {
  return state.objective.zone[0] ?? { q: 0, r: 0 };
}

function playerUnits(state: GameState): UnitInstance[] {
  return livingUnits(state).filter((u) => u.controller === "player");
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

/** Fire at the most dangerous (highest unsuppressed firepower) reachable enemy,
 *  so suppressive fire degrades the threat that matters most. */
function focusFire(state: GameState, u: UnitInstance): void {
  const enemySide = u.side === "blue" ? "red" : "blue";
  let best: UnitInstance | undefined;
  let bestThreat = -1;
  for (const e of livingUnits(state, enemySide)) {
    if (!canAttack(state, u, 0, e)) continue;
    const w = unitType(e.typeId).weapons[0];
    const threat = (w ? w.damage * w.accuracy : 0) * (e.crits.includes("shaken") ? 0.2 : 1);
    if (threat > bestThreat) {
      bestThreat = threat;
      best = e;
    }
  }
  if (best) attackUnit(state, u, 0, best);
  else fireBest(state, u);
}

/** The player does nothing — the mechs fight unsupported. */
export const noSupport: PlayerPolicy = () => {};

/** The defined player support plan (brief §4 criterion 1): recon scouts the
 *  approach, artillery suppresses the revealed defenders, supply keeps the mech
 *  fed, armour/infantry screen the advance. */
export const playerSupport: PlayerPolicy = (state) => {
  const obj = objectiveHex(state);
  for (const u of playerUnits(state)) {
    const cls = unitType(u.typeId).cls;
    if (cls === "supply") {
      const needy = playerUnits(state).concat(livingUnits(state, u.side))
        .find((t) => t.id !== u.id && hexDistance(u.hex, t.hex) === 1 && needsSupply(t));
      if (needy) resupplyUnit(state, u, needy);
      else {
        const mech = nearestMech(state, u.side, u.hex);
        if (mech) stepToward(state, u, mech.hex, 3);
      }
      continue;
    }
    if (cls === "artillery") {
      focusFire(state, u); // suppress the most dangerous defender, not just the nearest
      continue;
    }
    if (cls === "recon") {
      if (hexDistance(u.hex, obj) > 9) stepToward(state, u, obj, 3);
      fireBest(state, u);
      continue;
    }
    stepToward(state, u, obj, 3);
    fireBest(state, u);
  }
};
