import { unitType } from "../data/units";
import { resupplyUnit } from "./actions";
import { fireBest, nearestEnemyHex, stepToward } from "./aiutil";
import { commandMechs } from "./commander";
import { hexDistance, type Hex } from "./hex";
import { livingUnits, type GameState, type UnitInstance } from "./state";
import { beginTurn, nextPhase } from "./turn";

// A deterministic scripted skirmish for the headless capture. The MECHS are
// driven by the real commander AI (Slice 4); only the support/logistics units
// are scripted here (a stand-in for the player) — recon scouts forward, artillery
// shapes, supply follows. Drives the sim only through the shared action API.

function actUnit(state: GameState, u: UnitInstance, objectiveHex: Hex): void {
  const cls = unitType(u.typeId).cls;
  if (cls === "supply") {
    const needy = livingUnits(state, u.side).find(
      (t) =>
        t.id !== u.id &&
        hexDistance(u.hex, t.hex) === 1 &&
        (t.fuel < unitType(t.typeId).fuelMax * 0.6 ||
          t.ammo.some((a, i) => a < unitType(t.typeId).weapons[i].ammoMax)),
    );
    if (needy) {
      resupplyUnit(state, u, needy);
      return;
    }
    stepToward(state, u, objectiveHex, 3);
    return;
  }
  if (cls !== "artillery") {
    const goal = u.side === "blue" ? objectiveHex : nearestEnemyHex(state, u) ?? objectiveHex;
    stepToward(state, u, goal, 3);
  }
  fireBest(state, u);
}

export function scriptedSkirmish(state: GameState, turns = 6): void {
  beginTurn(state);
  const objectiveHex = state.objective.zone[0] ?? { q: 0, r: 0 };
  for (let step = 0; step < turns * 3; step++) {
    // Support/logistics (the player's stand-in) is scripted; the mechs are the AI.
    for (const u of livingUnits(state)) {
      if (unitType(u.typeId).cls !== "mech") actUnit(state, u, objectiveHex);
    }
    commandMechs(state, "blue");
    commandMechs(state, "red");
    nextPhase(state);
  }
}
