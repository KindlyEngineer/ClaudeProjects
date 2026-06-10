import { RULES } from "../data/rules";
import type { Side } from "../data/types";
import { unitType } from "../data/units";
import { rollDice } from "./dice";
import { emit } from "./events";
import { hexDistance, hexKey, type Hex } from "./hex";
import { livingUnits, type GameState } from "./state";
import { isScouted } from "./vision";

// Off-map assets (M1): side-level air support, budgeted per battle and topped up
// from the operation stockpile. Two verbs, matching the game's fires+intel
// split: a STRIKE (kinetic, needs an OBSERVED target — the forward-observer
// rule extends to the air) and a RECON OVERFLIGHT (a turn of eyes over a
// corridor, which can itself observe targets for strikes and artillery).
// Side-level: no on-board unit acts; the budget is the limiter. Both sides —
// player and AI — call them through these same functions.

export interface StrikeResult {
  ok: boolean;
  reason?: string;
  hexes: Hex[];
  hits: Array<{ id: number; damage: number; destroyed: boolean }>;
}

export interface ReconFlightResult {
  ok: boolean;
  reason?: string;
  hexes: Hex[];
}

function footprint(state: GameState, center: Hex, radius: number): Hex[] {
  return state.map.cells.filter((c) => hexDistance(c.hex, center) <= radius).map((c) => c.hex);
}

/** May `side` put a strike on `target` right now? */
export function canCallStrike(state: GameState, side: Side, target: Hex): { ok: boolean; reason?: string } {
  if (state.offmap[side].strike <= 0) return { ok: false, reason: "no strike sorties left" };
  if (!state.cells.has(hexKey(target))) return { ok: false, reason: "off map" };
  if (!isScouted(state, side, target)) return { ok: false, reason: "target not observed" };
  return { ok: true };
}

/** Air strike: rolls per enemy unit in the footprint (seeded + logged); a hit
 *  rattles, a penetrating hit (vs deck ≈ SIDE armour) damages. Every enemy in
 *  the footprint takes suppression — near misses are loud. */
export function callStrike(state: GameState, side: Side, target: Hex): StrikeResult {
  const gate = canCallStrike(state, side, target);
  if (!gate.ok) return { ok: false, reason: gate.reason, hexes: [], hits: [] };
  const cfg = RULES.offmap.strike;
  const hexes = footprint(state, target, cfg.radius);
  const keys = new Set(hexes.map(hexKey));

  const hits: StrikeResult["hits"] = [];
  const targets = livingUnits(state)
    .filter((u) => u.side !== side && keys.has(hexKey(u.hex)))
    .sort((a, b) => a.id - b.id); // deterministic resolution order
  for (const u of targets) {
    u.suppression += cfg.suppression;
    if (u.suppression >= RULES.suppressionBreak && !u.crits.includes("shaken")) u.crits.push("shaken");
    const roll = rollDice(state, "strike", `${side}→${u.typeId}#${u.id}`);
    if (roll >= cfg.accuracy) continue; // missed this one
    if (cfg.penetration >= unitType(u.typeId).armor.side) {
      u.structure = Math.max(0, u.structure - cfg.damage);
      hits.push({ id: u.id, damage: cfg.damage, destroyed: u.structure <= 0 });
    } else {
      hits.push({ id: u.id, damage: 0, destroyed: false });
    }
  }

  state.offmap[side].strike -= 1;
  emit(state, { kind: "offmap", asset: "strike", side, at: { ...target }, hexes, hits });
  return { ok: true, hexes, hits };
}

/** May `side` fly a recon pass over `target` right now? */
export function canCallReconFlight(state: GameState, side: Side, target: Hex): { ok: boolean; reason?: string } {
  if (state.offmap[side].recon <= 0) return { ok: false, reason: "no overflights left" };
  if (!state.cells.has(hexKey(target))) return { ok: false, reason: "off map" };
  return { ok: true };
}

/** Recon overflight: the side sees (and may engage) inside the footprint for the
 *  remainder of this turn. Sightings are injected immediately so the picture —
 *  and the fire-eligibility it grants — updates without waiting for upkeep. */
export function callReconFlight(state: GameState, side: Side, target: Hex): ReconFlightResult {
  const gate = canCallReconFlight(state, side, target);
  if (!gate.ok) return { ok: false, reason: gate.reason, hexes: [] };
  const radius = RULES.offmap.reconFlight.radius;
  state.airRecon.push({ side, center: { ...target }, radius, calledTurn: state.turn });

  // Fresh sightings for everything under the lens, effective NOW.
  for (const e of livingUnits(state)) {
    if (e.side === side || hexDistance(e.hex, target) > radius) continue;
    state.belief[side].set(e.id, {
      id: e.id,
      typeId: e.typeId,
      side: e.side,
      hex: { ...e.hex },
      facing: e.facing,
      structure: e.structure,
      suppression: e.suppression,
      crits: [...e.crits],
      lastSeenTurn: state.turn,
      visibleNow: true,
    });
  }

  state.offmap[side].recon -= 1;
  const hexes = footprint(state, target, radius);
  emit(state, { kind: "offmap", asset: "recon", side, at: { ...target }, hexes, hits: [] });
  return { ok: true, hexes };
}

/** Is `hex` inside one of `side`'s active overflight footprints? */
export function underAirRecon(state: GameState, side: Side, hex: Hex): boolean {
  return state.airRecon.some(
    (a) => a.side === side && a.calledTurn === state.turn && hexDistance(a.center, hex) <= a.radius,
  );
}

/** Drop expired coverage (an overflight lasts the turn it was called). */
export function expireAirRecon(state: GameState): void {
  state.airRecon = state.airRecon.filter((a) => a.calledTurn >= state.turn);
}
