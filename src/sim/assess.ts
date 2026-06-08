import { RULES } from "../data/rules";
import type { Side } from "../data/types";
import { unitType } from "../data/units";
import { hexDistance, type Hex } from "./hex";
import { aiNoise } from "./ainoise";
import { believedEnemies, visibleSightings } from "./knowledge";
import { hasCrit, livingUnits, type GameState, type PostureState, type Sighting, type UnitInstance } from "./state";
import { isScouted } from "./vision";

type PostureKind = PostureState["kind"];

// Situational assessment — the basis for "no aggression without knowledge". A
// side rates its advantage ONLY from belief (its own force, fully known, vs the
// enemy it has perceived), and inflates the unknown: unscouted approach ground
// is assumed to hide strength, so a thin picture can never justify an attack.
// The side must PROBE to scout, and only then — if it perceives a real edge —
// commit. All deterministic.

function nominalStrength(typeId: string): number {
  const t = unitType(typeId);
  const firepower = t.weapons.reduce((s, w) => s + w.damage * w.accuracy, 0);
  return t.structure + firepower * 1.5;
}

function ownStrength(units: UnitInstance[]): number {
  let total = 0;
  for (const u of units) {
    const max = unitType(u.typeId).structure;
    const fn = hasCrit(u, "weapon") || hasCrit(u, "shaken") ? 0.4 : 1; // can it still fight?
    const sup = u.inSupply ? 1 : 0.7;
    total += nominalStrength(u.typeId) * (u.structure / max) * fn * sup;
  }
  return total;
}

function believedStrength(sightings: Sighting[]): number {
  let total = 0;
  for (const s of sightings) {
    const max = unitType(s.typeId).structure;
    const stale = s.visibleNow ? 1 : 0.7; // remembered intel is less certain
    total += nominalStrength(s.typeId) * (s.structure / max) * stale;
  }
  return total;
}

/** How well `side` has scouted the ground AROUND a contact (radius `R`) — i.e.
 *  whether the spearhead is confirmed isolated or could be hiding support. This
 *  is the basis of confidence: you don't attack a unit whose surroundings you
 *  can't see (it might be the tip of something bigger). */
function localScouted(state: GameState, side: Side, center: Hex, R = 5): number {
  const hexes = state.map.cells.filter((c) => hexDistance(c.hex, center) <= R);
  if (hexes.length === 0) return 1;
  let seen = 0;
  for (const c of hexes) if (isScouted(state, side, c.hex)) seen++;
  return seen / hexes.length;
}

export interface Assessment {
  advantage: number; // perceived own:enemy strength ratio (uncertainty-inflated)
  scouted: number; // 0..1 fraction of the approach scouted
  haveContact: boolean; // currently sees at least one enemy
  targetId: number | null; // the deepest-penetrating visible enemy (the threat to strike)
}

/** Assess `side`'s situation from what it KNOWS (belief), inflating the unknown. */
export function assess(state: GameState, side: Side): Assessment {
  const visible = visibleSightings(state, side);
  const believed = believedEnemies(state, side);

  // The threat to strike: the visible enemy that has pushed deepest toward us.
  const objQ = Math.round(state.objective.zone.reduce((s, h) => s + h.q, 0) / Math.max(1, state.objective.zone.length));
  const defendFromMinQ = state.objective.attacker !== "blue";
  let target: Sighting | null = null;
  let bestDepth = -Infinity;
  for (const s of visible) {
    const depth = defendFromMinQ ? objQ - s.hex.q : s.hex.q - objQ;
    if (depth > bestDepth) {
      bestDepth = depth;
      target = s;
    }
  }

  // Confidence = how well we've scouted around that contact (is it isolated?).
  const scouted = target ? localScouted(state, side, target.hex) : 0;
  const own = ownStrength(livingUnits(state, side));
  const hidden = (1 - scouted) * RULES.commander.unknownStrength; // unseen ground may hide support
  const enemy = believedStrength(believed) + hidden;
  // Fallible commanders misjudge the odds (seeded, ± and scaled by 1 - skill):
  // sometimes over-confident, sometimes timid.
  const err = (aiNoise(state, side, 7717) - 0.5) * 2 * (1 - state.skill[side]) * RULES.commander.assessError;
  const advantage = (own / Math.max(1, enemy)) * (1 + err);

  return { advantage, scouted, haveContact: visible.length > 0, targetId: target?.id ?? null };
}

/** Update the defender's posture with hysteresis: it gathers information (probe)
 *  until confident, then commits (counter) only on a perceived advantage, and
 *  falls back to hold otherwise. Aggression is never taken on an unknown. */
export function updatePostures(state: GameState): void {
  const defender: Side = state.objective.attacker === "blue" ? "red" : "blue";
  const c = RULES.commander;
  const a = assess(state, defender);
  const cur = state.posture[defender];

  let next: PostureKind = cur.kind;
  if (cur.kind === "counter") {
    // Stay committed while the edge holds and the target is still in view.
    next = a.haveContact && a.advantage >= c.counterHysteresis && a.targetId !== null ? "counter" : "hold";
  } else if (!a.haveContact || a.scouted < c.minScoutToCommit) {
    next = "probe"; // not enough information — go and get it
  } else if (a.advantage >= c.counterAdvantage && a.targetId !== null) {
    next = "counter"; // scouted, confident, and ahead → strike
  } else {
    next = "hold";
  }

  if (next !== cur.kind) state.posture[defender] = { kind: next, since: state.turn, targetId: a.targetId };
  else state.posture[defender].targetId = a.targetId;
}
