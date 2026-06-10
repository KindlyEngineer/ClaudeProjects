import { effectDef, type EffectId } from "../data/effects";
import { terrain } from "../data/terrain";
import type { Side } from "../data/types";
import { hexEquals, type Hex } from "./hex";
import type { GameState } from "./state";

// Battlefield effects on the ground (smoke, fortifications) and the SHARED
// terrain queries that fold them in. Movement, combat cover and line-of-sight
// all read the ground through these three functions, so the player, the AI and
// the harness all see the same battlefield — laying smoke genuinely blinds,
// fortifying genuinely slows and shelters, with no consumer-specific branches.

export interface BattlefieldEffect {
  kind: EffectId;
  hex: Hex;
  expiresTurn: number | null; // dissipates at the START of this turn; null = permanent
  side?: Side; // minefields belong to the side that laid them (owner-safe)
}

export function effectsAt(state: GameState, hex: Hex): BattlefieldEffect[] {
  return state.effects.filter((e) => hexEquals(e.hex, hex));
}

export function hasEffect(state: GameState, hex: Hex, kind: EffectId): boolean {
  return state.effects.some((e) => e.kind === kind && hexEquals(e.hex, hex));
}

/** Place (or refresh) an effect on a hex. Same-kind effects don't stack —
 *  re-applying refreshes the expiry instead. */
export function addEffect(state: GameState, kind: EffectId, hex: Hex, side?: Side): void {
  const def = effectDef(kind);
  const expiresTurn = def.duration === null ? null : state.turn + def.duration;
  const existing = state.effects.find((e) => e.kind === kind && hexEquals(e.hex, hex));
  if (existing) {
    existing.expiresTurn = expiresTurn;
    existing.side = side ?? existing.side;
    return;
  }
  state.effects.push({ kind, hex: { ...hex }, expiresTurn, ...(side ? { side } : {}) });
}

/** The minefield on `hex` that threatens `victimSide` (i.e. laid by the other
 *  side), if any. Owner-safe: your own lanes are marked. */
export function hostileMinefieldAt(state: GameState, victimSide: Side, hex: Hex): BattlefieldEffect | undefined {
  return state.effects.find((e) => e.kind === "minefield" && e.side !== undefined && e.side !== victimSide && hexEquals(e.hex, hex));
}

/** Remove one effect instance (a triggered mine, a cleared field). */
export function removeEffect(state: GameState, effect: BattlefieldEffect): void {
  const i = state.effects.indexOf(effect);
  if (i >= 0) state.effects.splice(i, 1);
}

/** Remove effects whose time is up. Run in turn upkeep. */
export function expireEffects(state: GameState): void {
  state.effects = state.effects.filter((e) => e.expiresTurn === null || e.expiresTurn > state.turn);
}

// ── The shared ground queries (terrain + whatever stands on it) ───────────────

/** Movement cost to enter a hex (terrain + effects). Infinity = impassable. */
export function moveCostAt(state: GameState, hex: Hex): number {
  const cell = state.cells.get(`${hex.q},${hex.r}`);
  if (!cell) return Infinity;
  let cost = terrain(cell.terrain).moveCost;
  for (const e of effectsAt(state, hex)) cost += effectDef(e.kind).moveCostDelta;
  return cost;
}

/** Defensive cover at a hex (terrain + effects). */
export function coverAt(state: GameState, hex: Hex): number {
  const cell = state.cells.get(`${hex.q},${hex.r}`);
  if (!cell) return 0;
  let cover = terrain(cell.terrain).cover;
  for (const e of effectsAt(state, hex)) cover += effectDef(e.kind).cover;
  return cover;
}

/** Does this hex block a sightline crossing it (terrain or smoke)? */
export function sightBlockedAt(state: GameState, hex: Hex): boolean {
  const cell = state.cells.get(`${hex.q},${hex.r}`);
  if (!cell) return false;
  if (terrain(cell.terrain).blocksLineOfSight) return true;
  return effectsAt(state, hex).some((e) => effectDef(e.kind).blocksLineOfSight);
}
