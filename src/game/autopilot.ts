import type { InputState } from "../sim/sim";

// Deterministic input driver used by the screenshot harness (and handy in dev):
// `?pilot=circle` makes the player kite in a loop so the swarm, the auto-weapon,
// and the resulting XP-gem trail all appear in a reproducible capture.

export type Pilot = "none" | "circle" | "east" | "west" | "north" | "south";

export function parsePilot(value: string | null): Pilot {
  switch (value) {
    case "circle":
    case "east":
    case "west":
    case "north":
    case "south":
      return value;
    default:
      return "none";
  }
}

/** Movement intent for a given pilot at simulation time `t`. */
export function pilotInput(pilot: Pilot, t: number): InputState {
  switch (pilot) {
    case "circle": {
      // A steadily turning heading traces a circular kiting path.
      const a = t * 0.9;
      return { x: Math.cos(a), z: Math.sin(a) };
    }
    case "east":
      return { x: 1, z: 0 };
    case "west":
      return { x: -1, z: 0 };
    case "north":
      return { x: 0, z: -1 };
    case "south":
      return { x: 0, z: 1 };
    default:
      return { x: 0, z: 0 };
  }
}
