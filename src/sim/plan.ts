import { terrain } from "../data/terrain";
import type { Side } from "../data/types";
import { unitType } from "../data/units";
import { hexDistance, hexKey, type Hex } from "./hex";
import { aiNoise } from "./ainoise";
import { believedEnemies } from "./knowledge";
import { livingUnits, type GameState } from "./state";

// Force-level planning. Before units act, the AI forms a plan for its side and
// assigns each unit a TASK (where to be, what posture). The plan is DETERMINISTIC
// (seeded) but VARIED and PROACTIVE: a defender doesn't just sit on the point —
// it picks prepared positions in cover/overwatch, varies how far forward it sets
// up, sometimes pushes a screen or sends a rover, and keeps the rear safe. The
// variety comes from seeded "AI noise", so the same seed replays identically
// (self-play/tests hold) while no two seeds — and few turns — play the same way.

export type TaskKind = "hold" | "screen" | "rove" | "rear" | "probe" | "counter" | "advance";

export interface Task {
  goalHex: Hex;
  kind: TaskKind;
}

export interface ForcePlan {
  tasks: Map<number, Task>;
}

function centroid(hexes: readonly Hex[]): Hex {
  if (hexes.length === 0) return { q: 0, r: 0 };
  let q = 0;
  let r = 0;
  for (const h of hexes) {
    q += h.q;
    r += h.r;
  }
  return { q: Math.round(q / hexes.length), r: Math.round(r / hexes.length) };
}

function passable(state: GameState, h: Hex): boolean {
  const cell = state.cells.get(hexKey(h));
  return !!cell && Number.isFinite(terrain(cell.terrain).moveCost);
}

/** Build the side's plan. The attacker keeps default goals (objective-seeking,
 *  handled by the unit AI); the defender is positioned deliberately. */
/** The zone hex least covered by perceived defenders — the attacker's weak point
 *  to maneuver against. Recomputed from belief each turn, so the axis SHIFTS if
 *  the defence repositions to cover it. */
export function leastDefendedZoneHex(state: GameState, side: Side): Hex {
  const believed = believedEnemies(state, side);
  const zone = state.objective.zone;
  let best = zone[0] ?? { q: 0, r: 0 };
  let bestDef = Infinity;
  for (const z of zone) {
    let def = 0;
    for (const e of believed) {
      const w = unitType(e.typeId).weapons[0];
      if (w && hexDistance(e.hex, z) <= w.rangeMax) def += w.damage * w.accuracy;
    }
    if (def < bestDef || (def === bestDef && hexKey(z) < hexKey(best))) {
      bestDef = def;
      best = z;
    }
  }
  return best;
}

export function planForce(state: GameState, side: Side): ForcePlan {
  const tasks = new Map<number, Task>();
  if (side === state.objective.attacker) {
    // Attacker: maneuver elements push the perceived weak point (adaptive — the
    // axis shifts as the defence moves); fire support, recon and supply keep
    // their roles (shell from range, scout, sustain). Units still seize any hex.
    const axis = leastDefendedZoneHex(state, side);
    for (const u of livingUnits(state, side)) {
      if (u.controller !== "ai") continue;
      const cls = unitType(u.typeId).cls;
      if (cls === "mech" || cls === "armor" || cls === "infantry" || cls === "engineer") {
        tasks.set(u.id, { goalHex: axis, kind: "advance" }); // commit to the axis
      } else if (cls === "recon") {
        tasks.set(u.id, { goalHex: axis, kind: "probe" }); // scout the weak point
      }
      // artillery / supply: no task — their role behaviour (standoff fire,
      // sustainment) is already right.
    }
    return { tasks };
  }

  const zone = state.objective.zone;
  const obj = centroid(zone);
  // The threat comes from the attacker's home edge; "forward" faces it.
  const threatFromMinQ = state.objective.attacker === "blue";
  const forwardSign = threatFromMinQ ? -1 : 1;

  // Seeded variety: how far forward the prepared positions sit.
  const forwardness = 1 + Math.floor(aiNoise(state, side, 1) * 3); // 1..3 hexes
  const idealForwardQ = obj.q + forwardSign * forwardness;
  // Candidate prepared positions: near the objective, cover preferred, on the
  // threat-facing side; a seeded jitter per hex breaks ties → varied layouts.
  const cand = state.map.cells
    .filter((c) => passable(state, c.hex) && hexDistance(c.hex, obj) <= 4)
    .map((c) => {
      const t = terrain(c.terrain);
      const forwardFit = -Math.abs(c.hex.q - idealForwardQ); // near the chosen depth
      const jitter = aiNoise(state, side, c.hex.q * 31 + c.hex.r * 7) * 1.4;
      return { hex: c.hex, score: t.cover * 2 + forwardFit + jitter - hexDistance(c.hex, obj) * 0.2 };
    })
    .sort((a, b) => b.score - a.score)
    .map((c) => c.hex);

  const used = new Set<string>();
  const take = (pred: (h: Hex) => boolean): Hex | undefined => {
    for (const h of cand) {
      if (!used.has(hexKey(h)) && pred(h)) {
        used.add(hexKey(h));
        return h;
      }
    }
    return undefined;
  };
  const nearestZoneHex = (from: Hex): Hex => {
    let best = zone[0] ?? obj;
    let bd = Infinity;
    for (const z of zone) {
      const d = hexDistance(from, z);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  };
  // A safe hex to the rear (away from the threat) for the supply train.
  const rearQ = obj.q - forwardSign * 3;
  const rearHex =
    state.map.cells
      .filter((c) => passable(state, c.hex) && hexDistance(c.hex, obj) <= 5)
      .map((c) => ({ hex: c.hex, d: Math.abs(c.hex.q - rearQ) + hexDistance(c.hex, obj) * 0.3 }))
      .sort((a, b) => a.d - b.d)[0]?.hex ?? obj;

  // Posture (set with hysteresis by assess.updatePostures) shapes the plan.
  const posture = state.posture[side].kind;
  const targetId = state.posture[side].targetId;
  const targetHex = targetId !== null ? state.belief[side].get(targetId)?.hex : undefined;
  // A forward point to push recon toward when gaining information.
  const probeHex = nearestPassable(state, { q: obj.q + forwardSign * 8, r: obj.r }, obj) ?? obj;

  for (const u of livingUnits(state, side)) {
    const cls = unitType(u.typeId).cls;
    if (cls === "supply") {
      tasks.set(u.id, { goalHex: rearHex, kind: "rear" }); // train stays safe
    } else if (cls === "recon" && (posture === "probe" || posture === "counter")) {
      tasks.set(u.id, { goalHex: probeHex, kind: "probe" }); // gain / keep contact
    } else if (posture === "counter" && targetHex && (cls === "mech" || cls === "armor")) {
      tasks.set(u.id, { goalHex: targetHex, kind: "counter" }); // strike the exposed threat
    } else if (cls === "mech") {
      tasks.set(u.id, { goalHex: nearestZoneHex(u.hex), kind: "hold" }); // anchor the objective
    } else {
      tasks.set(u.id, { goalHex: take(() => true) ?? u.hex, kind: "hold" }); // prepared position
    }
  }
  return { tasks };
}

/** Nearest passable cell to an approximate point (tie-broken toward `anchor`). */
function nearestPassable(state: GameState, approx: Hex, anchor: Hex): Hex | undefined {
  return state.map.cells
    .filter((c) => passable(state, c.hex))
    .map((c) => ({ hex: c.hex, d: hexDistance(c.hex, approx) + hexDistance(c.hex, anchor) * 0.2 }))
    .sort((a, b) => a.d - b.d)[0]?.hex;
}
