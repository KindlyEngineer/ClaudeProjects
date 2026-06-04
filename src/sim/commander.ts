import { clamp } from "../core/math";
import { RULES } from "../data/rules";
import type { Side } from "../data/types";
import { unitType } from "../data/units";
import { attackUnit, moveUnit } from "./actions";
import { hexDistance, hexKey, type Hex } from "./hex";
import { supplySources } from "./logistics";
import { pathTo, reachable } from "./pathing";
import { canMove, livingUnits, terrainAt, type GameState, type UnitInstance } from "./state";
import { isEligible } from "./turn";
import { isScouted, visibleEnemies } from "./vision";

// The mech commander: a capability-aware, objective-seeking UTILITY AI. For each
// mech it scores every reachable hex by a transparent weighted sum and takes the
// best — then fires. Crucially, every term is a player lever (brief §2):
//   • objective pull        — fixed by the mission
//   • supply pull × need    — RESUPPLY raises sustainment, easing the pull back
//   • exposure (threat)     — FIRES suppress enemies and SCREENING/cover lower it
//   • fog caution           — RECON scouts hexes, removing the "blind" penalty
//   • attack opportunity     — degraded/suppressed enemies invite the assault
// It is deterministic (no RNG) and inspectable: decideMech() is pure and returns
// the chosen action plus a human-readable intent, so the player can predict and
// shape it. Legibility is a gameplay requirement, not a debug nicety.

export type Stance = "advance" | "assault" | "consolidate" | "resupply" | "hold" | "immobilised";

export interface CommanderDecision {
  unitId: number;
  stance: Stance;
  intent: string;
  destination: Hex;
  path: Hex[];
  fireTargetId: number | null;
}

export interface Sustainment {
  need: number; // 0..1 — how badly it needs to break contact and resupply
  reason: string; // "low ammo" | "low fuel" | "heavy damage" | ""
}

export function sustainmentNeed(unit: UnitInstance): Sustainment {
  const t = unitType(unit.typeId);
  const c = RULES.commander;
  const ammoMax = t.weapons.reduce((s, w) => s + w.ammoMax, 0);
  const ammoFrac = ammoMax ? unit.ammo.reduce((s, a) => s + a, 0) / ammoMax : 1;
  const fuelFrac = t.fuelMax ? unit.fuel / t.fuelMax : 1;
  const structFrac = unit.structure / t.structure;
  const ammoNeed = clamp((c.ammoLow - ammoFrac) / c.ammoLow, 0, 1);
  const fuelNeed = clamp((c.fuelLow - fuelFrac) / c.fuelLow, 0, 1);
  const dmgNeed = clamp((c.structLow - structFrac) / c.structLow, 0, 1);
  const need = Math.max(ammoNeed, fuelNeed, dmgNeed);
  let reason = "";
  if (need > 0) reason = need === ammoNeed ? "low ammo" : need === fuelNeed ? "low fuel" : "heavy damage";
  return { need, reason };
}

function supportNear(state: GameState, side: Side, hex: Hex): number {
  const c = RULES.commander;
  return livingUnits(state, side).filter(
    (u) => unitType(u.typeId).cls !== "mech" && hexDistance(u.hex, hex) <= c.supportRadius,
  ).length;
}

/** How exposed a hex is for `side`: incoming enemy fire (reduced by enemy
 *  suppression, terrain cover and nearby support) plus a caution penalty for
 *  advancing into hexes the side hasn't scouted. */
export function exposureAt(state: GameState, side: Side, hex: Hex, enemies: UnitInstance[]): number {
  const c = RULES.commander;
  let threat = 0;
  for (const e of enemies) {
    const w = unitType(e.typeId).weapons[0];
    if (!w) continue;
    const d = hexDistance(e.hex, hex);
    if (d <= w.rangeMax) {
      const closeness = 0.25 + 0.75 * ((w.rangeMax - d) / w.rangeMax); // nearer = more exposed
      const suppFactor = clamp(1 - e.suppression / RULES.suppressionBreak, 0.2, 1); // FIRES lever
      threat += w.damage * w.accuracy * suppFactor * closeness;
    }
  }
  const cover = terrainAt(state, hex)?.cover ?? 0;
  threat *= clamp(1 - cover * c.coverExposureReduction, 0.2, 1);
  threat *= clamp(1 - supportNear(state, side, hex) * c.supportReduction, 0.3, 1);
  if (!isScouted(state, side, hex)) threat += c.fogCaution;
  return threat;
}

interface AttackOpp {
  value: number;
  target: UnitInstance | null;
}
function attackOpportunityAt(mech: UnitInstance, hex: Hex, enemies: UnitInstance[]): AttackOpp {
  const w = unitType(mech.typeId).weapons[0];
  if (!w) return { value: 0, target: null };
  let best = 0;
  let target: UnitInstance | null = null;
  for (const e of enemies) {
    const d = hexDistance(hex, e.hex);
    if (d < w.rangeMin || d > w.rangeMax) continue;
    const structFrac = e.structure / unitType(e.typeId).structure;
    const weakness = 1 - structFrac + e.suppression / RULES.suppressionBreak;
    const v = 1 + weakness;
    if (v > best) {
      best = v;
      target = e;
    }
  }
  return { value: best, target };
}

function objectiveHex(state: GameState): Hex {
  return state.objective.zone[0] ?? { q: 0, r: 0 };
}
function nearestDist(hex: Hex, points: Hex[]): number {
  let m = Infinity;
  for (const p of points) m = Math.min(m, hexDistance(hex, p));
  return Number.isFinite(m) ? m : 0;
}

/** Decide one mech's action this turn (pure — no mutation). */
export function decideMech(state: GameState, mech: UnitInstance): CommanderDecision {
  const side = mech.side;
  const enemies = visibleEnemies(state, side);
  const objHex = objectiveHex(state);
  const supplyPts = supplySources(state, side);
  const need = sustainmentNeed(mech);
  const c = RULES.commander;

  const dObjFrom = hexDistance(mech.hex, objHex);
  const dSupFrom = nearestDist(mech.hex, supplyPts);

  // Candidate destinations: just the current hex if immobilised, else reachable.
  const reach = reachable(state, mech);
  const mobile = canMove(mech);

  let bestKey = hexKey(mech.hex);
  let best = { hex: mech.hex, objGain: 0, supGain: 0, exp: exposureAt(state, side, mech.hex, enemies), atk: attackOpportunityAt(mech, mech.hex, enemies).value };
  let bestScore = -Infinity;
  const consider = (h: Hex, key: string) => {
    const objGain = dObjFrom - hexDistance(h, objHex);
    const supGain = dSupFrom - nearestDist(h, supplyPts);
    const exp = exposureAt(state, side, h, enemies);
    const atk = attackOpportunityAt(mech, h, enemies).value;
    const score = c.wObjective * objGain + c.wSupply * need.need * supGain - c.wThreat * exp + c.wAttack * atk;
    if (score > bestScore || (score === bestScore && key < bestKey)) {
      bestScore = score;
      bestKey = key;
      best = { hex: h, objGain, supGain, exp, atk };
    }
  };
  if (mobile) {
    for (const [k, node] of reach) consider(node.hex, k);
  } else {
    consider(mech.hex, hexKey(mech.hex));
  }

  const path = mobile ? pathTo(reach, bestKey) : [];
  const finalHex = best.hex;
  const fire = attackOpportunityAt(mech, finalHex, enemies);
  const fireTargetId = fire.target?.id ?? null;

  const stance = deriveStance({ mobile, need, best, dObjFrom, fireTargetId, enemiesSeen: enemies.length });
  const intent = deriveIntent(stance, { need, fire, enemiesSeen: enemies.length, exposed: best.exp });
  return { unitId: mech.id, stance, intent, destination: finalHex, path, fireTargetId };
}

function deriveStance(x: {
  mobile: boolean;
  need: Sustainment;
  best: { objGain: number };
  dObjFrom: number;
  fireTargetId: number | null;
  enemiesSeen: number;
}): Stance {
  if (!x.mobile) return "immobilised";
  if (x.need.need >= RULES.commander.needTrigger && x.best.objGain <= 0) return "resupply";
  if (x.dObjFrom === 0 && x.best.objGain <= 0) return "hold";
  if (x.best.objGain > 0) return "advance";
  if (x.fireTargetId !== null) return "assault";
  return "consolidate";
}

function deriveIntent(
  stance: Stance,
  x: { need: Sustainment; fire: AttackOpp; enemiesSeen: number; exposed: number },
): string {
  switch (stance) {
    case "immobilised":
      return x.fire.target ? "Immobilised — holding and returning fire" : "Immobilised — stranded, awaiting recovery";
    case "resupply":
      return `Breaking contact to resupply (${x.need.reason || "sustainment"})`;
    case "hold":
      return "Holding the objective";
    case "assault":
      return x.fire.target ? `Pressing the assault on ${unitType(x.fire.target.typeId).name}` : "Pressing the assault";
    case "advance":
      return "Advancing on the objective";
    case "consolidate":
    default:
      return x.enemiesSeen > 0 ? "Consolidating — axis too exposed" : "Holding — awaiting reconnaissance";
  }
}

/** Decide and execute every eligible mech of a side (drives the action API). */
export function commandMechs(state: GameState, side: Side): void {
  for (const mech of livingUnits(state, side)) {
    if (unitType(mech.typeId).cls !== "mech" || !isEligible(state, mech)) continue;
    const decision = decideMech(state, mech);
    state.intents[mech.id] = decision.intent;
    if (decision.path.length) moveUnit(state, mech, decision.path);
    if (decision.fireTargetId !== null) {
      const target = state.units.find((u) => u.id === decision.fireTargetId);
      if (target) attackUnit(state, mech, 0, target);
    }
  }
}
