import { mulberry32Step } from "../core/rng";
import type { Side } from "../data/types";
import type { GameState } from "./state";

// Deterministic "AI noise" — a reproducible pseudo-random value in [0,1) keyed by
// (seed, turn, side, salt). It is the source of the AI's *seeded* variety and
// *seeded* fallibility: different seeds (and turns) play differently, but the
// same seed replays identically, so self-play and tests stay deterministic.
export function aiNoise(state: GameState, side: Side, salt: number): number {
  const h =
    (Math.imul(state.seed | 1, 2654435761) ^
      Math.imul(state.turn + 1, 40503) ^
      (side === "blue" ? 0x9e3779b1 : 0x85ebca6b) ^
      Math.imul(salt + 1, 668265263)) |
    0;
  return mulberry32Step(h).value;
}
