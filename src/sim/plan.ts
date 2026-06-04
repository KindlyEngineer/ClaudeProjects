import { mulberry32Step } from "../core/rng";
import { terrain } from "../data/terrain";
import type { Side } from "../data/types";
import { unitType } from "../data/units";
import { hexDistance, hexKey, type Hex } from "./hex";
import { livingUnits, type GameState } from "./state";

// Force-level planning. Before units act, the AI forms a plan for its side and
// assigns each unit a TASK (where to be, what posture). The plan is DETERMINISTIC
// (seeded) but VARIED and PROACTIVE: a defender doesn't just sit on the point —
// it picks prepared positions in cover/overwatch, varies how far forward it sets
// up, sometimes pushes a screen or sends a rover, and keeps the rear safe. The
// variety comes from seeded "AI noise", so the same seed replays identically
// (self-play/tests hold) while no two seeds — and few turns — play the same way.

export type TaskKind = "hold" | "screen" | "rove" | "rear";

export interface Task {
  goalHex: Hex;
  kind: TaskKind;
}

export interface ForcePlan {
  tasks: Map<number, Task>;
}

/** Deterministic per-(seed, turn, side, salt) value in [0,1). Different seeds →
 *  different choices; same seed → identical. */
export function aiNoise(state: GameState, side: Side, salt: number): number {
  const h =
    (Math.imul(state.seed | 1, 2654435761) ^
      Math.imul(state.turn + 1, 40503) ^
      (side === "blue" ? 0x9e3779b1 : 0x85ebca6b) ^
      Math.imul(salt + 1, 668265263)) |
    0;
  return mulberry32Step(h).value;
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
export function planForce(state: GameState, side: Side): ForcePlan {
  const tasks = new Map<number, Task>();
  if (side === state.objective.attacker) return { tasks }; // attacker: AI-2 objective-seeking

  const zone = state.objective.zone;
  const obj = centroid(zone);
  // The threat comes from the attacker's home edge; "forward" faces it.
  const threatFromMinQ = state.objective.attacker === "blue";
  const forwardSign = threatFromMinQ ? -1 : 1;

  // Seeded posture: how far forward to set up, and whether the mech roves.
  const forwardness = 1 + Math.floor(aiNoise(state, side, 1) * 3); // 1..3 hexes
  const roveMech = aiNoise(state, side, 2) < 0.45; // sometimes the heavy element manoeuvres
  const screenFwd = aiNoise(state, side, 3) < 0.5; // sometimes push a forward screen

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

  for (const u of livingUnits(state, side)) {
    const cls = unitType(u.typeId).cls;
    if (cls === "supply") {
      tasks.set(u.id, { goalHex: rearHex, kind: "rear" });
    } else if (cls === "mech") {
      if (roveMech) {
        // Manoeuvre to a forward cover/overwatch position instead of sitting.
        const fwd = take((h) => forwardSign < 0 ? h.q < obj.q : h.q > obj.q) ?? nearestZoneHex(u.hex);
        tasks.set(u.id, { goalHex: fwd, kind: "rove" });
      } else {
        tasks.set(u.id, { goalHex: nearestZoneHex(u.hex), kind: "hold" }); // anchor the objective
      }
    } else if (screenFwd && (cls === "recon" || cls === "infantry")) {
      const screen = take((h) => (forwardSign < 0 ? h.q <= idealForwardQ : h.q >= idealForwardQ)) ?? u.hex;
      tasks.set(u.id, { goalHex: screen, kind: "screen" });
    } else {
      tasks.set(u.id, { goalHex: take(() => true) ?? u.hex, kind: "hold" });
    }
  }
  return { tasks };
}
