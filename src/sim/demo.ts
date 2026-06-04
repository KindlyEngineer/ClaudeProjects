import { terrain } from "../data/terrain";
import { unitType } from "../data/units";
import { attackUnit, canAttack, moveUnit, movePoints, resupplyUnit } from "./actions";
import { commandMechs } from "./commander";
import { hexDistance, hexKey, neighbors, type Hex } from "./hex";
import { livingUnits, type GameState, type UnitInstance } from "./state";
import { beginTurn, nextPhase } from "./turn";

// A deterministic scripted skirmish for the headless capture. The MECHS are
// driven by the real commander AI (Slice 4); only the support/logistics units
// are scripted here (a stand-in for the player) — recon scouts forward, artillery
// shapes, supply follows. Drives the sim only through the shared action API.

function passableUnoccupied(state: GameState, h: Hex, moverId: number): boolean {
  const cell = state.cells.get(hexKey(h));
  if (!cell || !Number.isFinite(terrain(cell.terrain).moveCost)) return false;
  return !livingUnits(state).some((u) => u.id !== moverId && u.hex.q === h.q && u.hex.r === h.r);
}

/** Greedily step toward `target` over open hexes, within MP/fuel budget. */
function stepToward(state: GameState, unit: UnitInstance, target: Hex, maxSteps: number): void {
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

function fireBest(state: GameState, unit: UnitInstance): void {
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

function nearestEnemyHex(state: GameState, unit: UnitInstance): Hex | undefined {
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
