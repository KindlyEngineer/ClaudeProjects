import type { Side } from "../data/types";
import type { Arc, Direction, Hex } from "./hex";
import type { GameState, Phase } from "./state";

// The sim's event stream: every action appends a plain, serializable record of
// WHAT HAPPENED (not just the resulting state). Pure data — no render types —
// so it stays deterministic and testable. Consumers: the interactive UI's
// animation playback (tween the move, flash the hit) and the combat log. The
// stream is append-only; readers keep their own cursor.

export type GameEvent =
  | { seq: number; turn: number; kind: "turn"; n: number }
  | { seq: number; turn: number; kind: "phase"; phase: Phase }
  | { seq: number; turn: number; kind: "move"; id: number; side: Side; path: Hex[]; from: Hex; facing: Direction }
  | { seq: number; turn: number; kind: "face"; id: number; side: Side; facing: Direction }
  | {
      seq: number;
      turn: number;
      kind: "fire";
      id: number;
      side: Side;
      targetId: number;
      weapon: string;
      from: Hex;
      at: Hex;
      hit: boolean;
      penetrated: boolean;
      damage: number;
      arc: Arc | null;
      crit: string | null;
      suppression: number;
      destroyed: boolean;
    }
  | { seq: number; turn: number; kind: "resupply"; id: number; side: Side; targetId: number; ammo: number; fuel: number };

// Omit must DISTRIBUTE over the union (plain Omit collapses it to common keys).
type EventInput = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "seq" | "turn"> : never) : never;

/** Append an event (assigns its sequence number). */
export function emit(state: GameState, ev: EventInput): void {
  state.events.push({ ...ev, seq: state.events.length, turn: state.turn } as GameEvent);
}
