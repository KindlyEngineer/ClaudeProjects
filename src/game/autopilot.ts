import type { InputState } from "../sim/sim";

// Deterministic input driver used by the screenshot harness (and handy in dev):
// `?pilot=circle` makes the player kite in a loop so the swarm, the auto-weapon,
// and the resulting XP-gem trail all appear in a reproducible capture.

export type Pilot = "none" | "circle";

export function parsePilot(value: string | null): Pilot {
  return value === "circle" ? "circle" : "none";
}

/** Movement intent for a given pilot at simulation time `t`. */
export function pilotInput(pilot: Pilot, t: number): InputState {
  if (pilot === "circle") {
    // A steadily turning heading traces a circular kiting path.
    const a = t * 0.9;
    return { x: Math.cos(a), z: Math.sin(a) };
  }
  return { x: 0, z: 0 };
}
