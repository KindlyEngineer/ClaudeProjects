import { mulberry32Step } from "../core/rng";
import type { GameState } from "./state";

// The one place randomness enters the sim. Every draw advances the game's RNG
// state (kept in plain data) and is appended to the roll log, so a match is
// deterministic and every roll is auditable by the headless harness (brief §3).

export function rollDice(state: GameState, kind: string, detail?: string): number {
  const { value, next } = mulberry32Step(state.rngState);
  state.rngState = next;
  state.rollLog.push({ turn: state.turn, kind, value, detail });
  return value;
}
