import { clamp } from "../core/math";
import { RULES } from "../data/rules";
import type { Side, UnitClass } from "../data/types";
import { unitType } from "../data/units";
import { attackUnit, canAttack, canFireMission, canFortify, fireMission, fortifyHex, moveUnit, resupplyUnit } from "./actions";
import { coverAt } from "./effects";
import { armorArc, hexDistance, hexKey, type Hex } from "./hex";
import { believedEnemies, visibleSightings } from "./knowledge";
import { needsSupply as supplyDeficit, supplySources } from "./logistics";
import { pathTo, reachable } from "./pathing";
import { canMove, elevationAt, livingUnits, type GameState, type UnitInstance } from "./state";
import { isEligible } from "./turn";
import { isScouted } from "./vision";
import { aiNoise } from "./ainoise";
import { planForce, type Task } from "./plan";

// The force AI: ONE capability-aware, fog-limited brain that commands whatever
// units are assigned to it (controller === "ai"), each according to its role.
// It is deterministic (no RNG) and inspectable. Action choice is a transparent
// sum of named "considerations" weighted per role, so new factors (terrain
// effects, battlefield effects, ZOC, …) slot in by adding a consideration + a
// weight — no rewrite. It reasons only on BELIEF (current sight + remembered
// last-known positions), never ground truth, and only fires on what it can see.

// A minimal enemy view — satisfied by a live UnitInstance and a remembered
// Sighting alike — so scoring runs on belief, not omniscience.
interface EnemyView {
  id: number;
  typeId: string;
  hex: Hex;
  facing: number;
  structure: number;
  suppression: number;
}

export type Stance =
  | "advance"
  | "assault"
  | "consolidate"
  | "resupply"
  | "hold"
  | "immobilised"
  | "scout"
  | "suppress"
  | "sustain"
  | "screen";

export interface UnitDecision {
  unitId: number;
  stance: Stance;
  intent: string;
  destination: Hex;
  path: Hex[];
  fireTargetId: number | null;
}

export interface Sustainment {
  need: number; // 0..1 — how badly it needs to break contact and resupply
  reason: string;
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

function supportNear(state: GameState, side: Side, hex: Hex, selfId: number): number {
  const r = RULES.commander.supportRadius;
  return livingUnits(state, side).filter((u) => u.id !== selfId && hexDistance(u.hex, hex) <= r).length;
}

/** Incoming-fire exposure at a hex (reduced by enemy suppression, cover and
 *  nearby support) plus a caution penalty for advancing into unscouted hexes. */
export function exposureAt(state: GameState, side: Side, hex: Hex, enemies: readonly EnemyView[]): number {
  const c = RULES.commander;
  let threat = 0;
  for (const e of enemies) {
    const w = unitType(e.typeId).weapons[0];
    if (!w) continue;
    const d = hexDistance(e.hex, hex);
    if (d <= w.rangeMax) {
      const closeness = 0.25 + 0.75 * ((w.rangeMax - d) / w.rangeMax);
      const suppFactor = clamp(1 - e.suppression / RULES.suppressionBreak, 0.2, 1);
      threat += w.damage * w.accuracy * suppFactor * closeness;
    }
  }
  const cover = coverAt(state, hex); // terrain + battlefield effects (fortifications shelter)
  threat *= clamp(1 - cover * c.coverExposureReduction, 0.2, 1);
  threat *= clamp(1 - supportNear(state, side, hex, -1) * c.supportReduction, 0.3, 1);
  if (!isScouted(state, side, hex)) threat += c.fogCaution;
  return threat;
}

/** Capability-aware value of a shot from `fromHex` at `target`: penetrating hits
 *  on the arc we'd actually strike score by the target's weakness (and FLANK
 *  shots score higher); a shot that can't penetrate is worth only its
 *  suppression; a shot that can neither penetrate nor suppress is worthless (0)
 *  — so the AI never takes futile shots. */
function shotValue(attacker: UnitInstance, fromHex: Hex, target: EnemyView): number {
  const ttype = unitType(target.typeId);
  let best = 0;
  for (const w of unitType(attacker.typeId).weapons) {
    const d = hexDistance(fromHex, target.hex);
    if (d < w.rangeMin || d > w.rangeMax) continue;
    const arc = armorArc(target.hex, target.facing as 0 | 1 | 2 | 3 | 4 | 5, fromHex);
    const weakness = 1 - target.structure / ttype.structure + target.suppression / RULES.suppressionBreak;
    let v = 0;
    if (w.penetration >= ttype.armor[arc]) {
      v = (1 + weakness) * (arc === "rear" ? 1.35 : arc === "side" ? 1.15 : 1.0); // reward flanks
    } else if (w.suppression > 0) {
      v = 0.25 * (w.suppression / 6); // can't kill it, but can pin it
    }
    best = Math.max(best, v);
  }
  return best;
}

function bestShotValue(attacker: UnitInstance, hex: Hex, targets: readonly EnemyView[]): number {
  let best = 0;
  for (const t of targets) best = Math.max(best, shotValue(attacker, hex, t));
  return best;
}

function nearestDist(hex: Hex, points: readonly Hex[]): number {
  let m = Infinity;
  for (const p of points) m = Math.min(m, hexDistance(hex, p));
  return Number.isFinite(m) ? m : 0;
}

// ── The consideration framework ──────────────────────────────────────────────
// Each consideration returns a raw (unweighted) value for a candidate hex; the
// role's weight scales it. Add a factor here + give roles a weight to use it.

interface AiContext {
  state: GameState;
  side: Side;
  unit: UnitInstance;
  believed: EnemyView[];
  visible: EnemyView[];
  believedHexes: Hex[];
  friendHexes: Hex[];
  goal: readonly Hex[]; // where this unit is trying to be (zone, or an assigned task hex)
  allowSeize: boolean; // only the attacker scores the seize bonus
  zone: readonly Hex[];
  zoneKeys: Set<string>;
  supplyPts: Hex[];
  needyHexes: Hex[];
  need: Sustainment;
  dObjFrom: number;
  dSupFrom: number;
  idealRange: number;
  enemyElev: number | null; // mean elevation of believed enemies (null = no contact)
}

type ConsiderationName =
  | "objective"
  | "seize"
  | "supply"
  | "exposure"
  | "attack"
  | "cover"
  | "standoff"
  | "mutual"
  | "nearNeedy"
  | "highGround";

const CONSIDERATIONS: Record<ConsiderationName, (ctx: AiContext, h: Hex) => number> = {
  objective: (ctx, h) => ctx.dObjFrom - nearestDist(h, ctx.goal),
  seize: (ctx, h) => (ctx.allowSeize && ctx.zoneKeys.has(hexKey(h)) ? 1 : 0),
  supply: (ctx, h) => ctx.need.need * (ctx.dSupFrom - nearestDist(h, ctx.supplyPts)),
  exposure: (ctx, h) => exposureAt(ctx.state, ctx.side, h, ctx.believed),
  attack: (ctx, h) => bestShotValue(ctx.unit, h, ctx.visible),
  cover: (ctx, h) => coverAt(ctx.state, h), // terrain + effects (a fortified hex is good ground)
  standoff: (ctx, h) => (ctx.believedHexes.length ? -Math.abs(nearestDist(h, ctx.believedHexes) - ctx.idealRange) : 0),
  // Isolation penalty: 0 while a friendly is within support range, growing
  // negative beyond it — discourages racing ahead of the force without stalling
  // an advance (it doesn't reward bunching up).
  mutual: (ctx, h) =>
    ctx.friendHexes.length ? -Math.max(0, nearestDist(h, ctx.friendHexes) - RULES.commander.supportRadius) : 0,
  nearNeedy: (ctx, h) => (ctx.needyHexes.length ? -nearestDist(h, ctx.needyHexes) : 0),
  // Seek ground that OVERLOOKS the enemy (height advantage = LOS + a to-hit
  // edge), not random peaks: 0 without contact, capped so a unit won't abandon
  // its job to climb. The AI now reads the heightmap the same way the player can.
  highGround: (ctx, h) =>
    ctx.enemyElev === null ? 0 : clamp(elevationAt(ctx.state, h) - ctx.enemyElev, 0, 3),
};

interface RoleProfile {
  weights: Partial<Record<ConsiderationName, number>>;
  idealRange: number;
  action: "fire" | "resupply" | "none";
  /** 0..1 — how readily the commander will SPEND this unit (accept its loss) for
   *  a worthwhile outcome. Scouts/screens are expendable; fire support and supply
   *  are precious. Only unlocked on committing tasks (advance / counter / probe). */
  expendable: number;
}

const W = RULES.commander;
const ROLE: Record<UnitClass, RoleProfile> = {
  // The spearhead: pulled to the objective/seize, but it advances WITH its
  // escort (mutual) rather than soloing into the defence, and breaks contact
  // when its sustainment runs low (supply × need).
  mech: { weights: { objective: W.wObjective, seize: W.wSeize, supply: W.wSupply, exposure: -W.wThreat, attack: W.wAttack, highGround: 0.3 }, idealRange: 0, action: "fire", expendable: 0.4 },
  recon: { weights: { objective: 1.2, exposure: -2.6, standoff: 1.6, cover: 0.6, supply: 0.5, mutual: 0.4, highGround: 0.7 }, idealRange: 9, action: "fire", expendable: 0.8 },
  artillery: { weights: { objective: 0.2, exposure: -3.0, standoff: 2.2, cover: 0.5, supply: 0.6, mutual: 0.4, highGround: 0.4 }, idealRange: 12, action: "fire", expendable: 0.1 },
  armor: { weights: { objective: 2, seize: 25, attack: 4, exposure: -1.0, cover: 0.8, standoff: 0.8, supply: 1.5, mutual: 0.6, highGround: 0.4 }, idealRange: 9, action: "fire", expendable: 0.4 },
  infantry: { weights: { objective: 1.5, seize: 25, attack: 3, exposure: -1.6, cover: 1.6, supply: 0.8, mutual: 1.0, highGround: 0.25 }, idealRange: 2, action: "fire", expendable: 0.65 },
  engineer: { weights: { objective: 1.5, attack: 2, exposure: -1.6, cover: 1.4, supply: 0.8, mutual: 1.0, highGround: 0.25 }, idealRange: 2, action: "fire", expendable: 0.5 },
  // Supply must keep up with the spearhead to sustain it (cautious, but it can't
  // hang back so far the advance runs dry).
  supply: { weights: { objective: 1.3, exposure: -1.2, nearNeedy: 3, supply: 1.0, mutual: 0.6 }, idealRange: 0, action: "resupply", expendable: 0.1 },
};

// The AI doesn't chase one-point top-ups — fuel counts as needy below 60%.
const needsSupply = (u: UnitInstance): boolean => supplyDeficit(u, 0.6);

/** Modulate a role's weights by its assigned task: a counterattack commits hard
 *  (more attack/objective, far less exposure-aversion), a probe pushes forward to
 *  gain contact, a hold settles into good defensive ground. */
function taskWeights(base: Partial<Record<ConsiderationName, number>>, task?: Task): Partial<Record<ConsiderationName, number>> {
  if (!task) return base;
  const w: Record<string, number> = { ...base };
  const add = (k: ConsiderationName, v: number) => (w[k] = (w[k] ?? 0) + v);
  const mul = (k: ConsiderationName, f: number) => w[k] !== undefined && (w[k] *= f);
  switch (task.kind) {
    case "counter":
      add("objective", 3);
      add("attack", 4);
      break;
    case "probe":
      add("objective", 1.5);
      mul("standoff", 0.3); // push out to make contact
      break;
    case "hold":
      add("cover", 0.6);
      add("standoff", 0.4);
      break;
    default:
      break;
  }
  return w as Partial<Record<ConsiderationName, number>>;
}

/** Decide one unit's move this turn (pure — no mutation), scoring reachable
 *  hexes by its role's weighted considerations. */
export function decideUnit(state: GameState, unit: UnitInstance, task?: Task): UnitDecision {
  const side = unit.side;
  const cls = unitType(unit.typeId).cls;
  const role = ROLE[cls];
  const believed = believedEnemies(state, side);
  const visible = visibleSightings(state, side);
  const zone = state.objective.zone;
  const goal = task ? [task.goalHex] : zone; // an assigned position, or the objective
  const ctx: AiContext = {
    state,
    side,
    unit,
    believed,
    visible,
    believedHexes: believed.map((e) => e.hex),
    friendHexes: livingUnits(state, side).filter((u) => u.id !== unit.id).map((u) => u.hex),
    goal,
    allowSeize: side === state.objective.attacker, // only the attacker takes the zone
    zone,
    zoneKeys: new Set(zone.map(hexKey)),
    supplyPts: supplySources(state, side),
    needyHexes: livingUnits(state, side).filter((u) => u.id !== unit.id && needsSupply(u)).map((u) => u.hex),
    need: sustainmentNeed(unit),
    dObjFrom: nearestDist(unit.hex, goal),
    dSupFrom: nearestDist(unit.hex, supplySources(state, side)),
    idealRange: role.idealRange,
    enemyElev: believed.length ? believed.reduce((s, e) => s + elevationAt(state, e.hex), 0) / believed.length : null,
  };

  const weights: Record<string, number> = { ...taskWeights(role.weights, task) };
  // Risk-vs-reward: keep units alive by default, but on a COMMITTING task accept
  // more risk to SPEND expendable units for the outcome — cheap scouts/screens go
  // forward; precious fire support and supply stay protected.
  const committing = task && (task.kind === "advance" || task.kind === "counter" || task.kind === "probe");
  if (committing && weights.exposure !== undefined) weights.exposure *= 1 - role.expendable;
  // Objective state & clock (the sixth commander input): the attacker drives
  // harder as the deadline nears, and Breakthrough outruns its supply for speed.
  if (side === state.objective.attacker) {
    const urgency = clamp(state.turn / Math.max(1, state.objective.turnLimit), 0, 1);
    if (weights.objective !== undefined) weights.objective *= 1 + urgency * 0.8;
    if (weights.supply !== undefined) {
      weights.supply *= (1 - urgency * 0.5) * (state.objective.kind === "breakthrough" ? 0.4 : 1);
    }
  }
  const entries = Object.entries(weights) as Array<[ConsiderationName, number]>;
  const score = (h: Hex): number => {
    let s = 0;
    for (const [name, w] of entries) s += w * CONSIDERATIONS[name](ctx, h);
    return s;
  };

  const mobile = canMove(unit);
  const reach = reachable(state, unit);
  const cands: Array<{ key: string; hex: Hex; score: number }> = [];
  if (mobile) for (const [k, node] of reach) cands.push({ key: k, hex: node.hex, score: score(node.hex) });
  else cands.push({ key: hexKey(unit.hex), hex: unit.hex, score: score(unit.hex) });

  let best = cands[0];
  for (const c of cands) if (c.score > best.score || (c.score === best.score && c.key < best.key)) best = c;

  // Fallibility: a less-than-perfect commander may take a good-but-not-best move
  // — a misstep, never a blunder (always within the satisfice band of the best),
  // and seeded so it's deterministic. At skill 1 the band is 0 → always optimal.
  let chosen = best;
  const band = (1 - state.skill[side]) * RULES.commander.satisficeBand;
  if (band > 0) {
    const eligible = cands
      .filter((c) => c.score >= best.score - band)
      .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
    const n = aiNoise(state, side, unit.id);
    chosen = eligible[Math.min((n * n * eligible.length) | 0, eligible.length - 1)]; // biased toward the top
  }
  const bestKey = chosen.key;
  const bestHex = chosen.hex;

  const path = mobile ? pathTo(reach, bestKey) : [];
  const fireTargetId = pickTarget(unit, bestHex, visible);
  const objGain = ctx.dObjFrom - nearestDist(bestHex, goal);
  // Is the chosen ground commanding — meaningfully above the perceived enemy?
  const highGround = ctx.enemyElev !== null && elevationAt(state, bestHex) - ctx.enemyElev >= 1.2;
  const { stance, intent } = describe(cls, ctx, { objGain, exposed: exposureAt(state, side, bestHex, believed), fireTargetId, mobile, highGround }, task);
  return { unitId: unit.id, stance, intent, destination: bestHex, path, fireTargetId };
}

/** The most valuable non-futile target visible from `hex`, or null. */
function pickTarget(attacker: UnitInstance, hex: Hex, visible: readonly EnemyView[]): number | null {
  let best: EnemyView | null = null;
  let bestV = 0;
  for (const t of visible) {
    const v = shotValue(attacker, hex, t);
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  return best?.id ?? null;
}

function describe(
  cls: UnitClass,
  ctx: AiContext,
  x: { objGain: number; exposed: number; fireTargetId: number | null; mobile: boolean; highGround: boolean },
  task?: Task,
): { stance: Stance; intent: string } {
  const tgtName = () => {
    const t = ctx.visible.find((e) => e.id === x.fireTargetId);
    return t ? unitType(t.typeId).name : "the enemy";
  };
  // A DEFENSIVE task reports what the plan has the unit doing; an "advance" task
  // (the attacker's chosen axis) falls through to the objective-seeking logic.
  if (task && task.kind !== "advance") {
    switch (task.kind) {
      case "probe":
        return { stance: "scout", intent: x.fireTargetId !== null ? `Probing — contact with ${tgtName()}` : "Probing forward to gain contact" };
      case "counter":
        return { stance: "assault", intent: x.fireTargetId !== null ? `Counterattacking ${tgtName()}` : "Counterattacking — exploiting the advantage" };
      case "screen":
        return { stance: "screen", intent: x.fireTargetId !== null ? `Screening — engaging ${tgtName()}` : "Screening the approach" };
      case "rove":
        return { stance: "screen", intent: x.fireTargetId !== null ? `Manoeuvring — engaging ${tgtName()}` : "Manoeuvring to better ground" };
      case "rear":
        return { stance: "sustain", intent: "Holding the rear" };
      case "hold":
      default:
        return { stance: "hold", intent: x.fireTargetId !== null ? `Holding — engaging ${tgtName()}` : "Holding a prepared position" };
    }
  }
  if (cls === "mech") {
    if (!x.mobile) return { stance: "immobilised", intent: x.fireTargetId !== null ? "Immobilised — holding and returning fire" : "Immobilised — stranded, awaiting recovery" };
    if (ctx.need.need >= W.needTrigger && x.objGain <= 0) return { stance: "resupply", intent: `Breaking contact to resupply (${ctx.need.reason || "sustainment"})` };
    if (ctx.dObjFrom === 0 && x.objGain <= 0) return { stance: "hold", intent: x.highGround ? "Holding the high ground on the objective" : "Holding the objective" };
    if (x.objGain > 0) return { stance: "advance", intent: x.highGround ? "Cresting the ridge — pressing the attack" : "Advancing on the objective" };
    if (x.fireTargetId !== null) return { stance: "assault", intent: x.highGround ? `Overwatch from high ground — engaging ${tgtName()}` : `Pressing the assault on ${tgtName()}` };
    return { stance: "consolidate", intent: ctx.believed.length > 0 ? "Consolidating — axis too exposed" : "Holding — awaiting reconnaissance" };
  }
  switch (cls) {
    case "recon":
      return { stance: "scout", intent: x.highGround ? "Overwatching from high ground" : ctx.believed.length ? "Scouting — eyes on the enemy" : "Scouting the approach" };
    case "artillery":
      return { stance: "suppress", intent: x.fireTargetId !== null ? `Suppressing ${tgtName()}` : "In battery — awaiting a fire mission" };
    case "supply":
      return { stance: "sustain", intent: ctx.needyHexes.length ? "Moving up to sustain the advance" : "Shadowing the spearhead" };
    default:
      if (x.objGain > 0) return { stance: "screen", intent: "Advancing in support" };
      if (x.fireTargetId !== null) return { stance: "assault", intent: `Engaging ${tgtName()}` };
      return { stance: "screen", intent: "Holding the line" };
  }
}

// ── Execution ────────────────────────────────────────────────────────────────

/** The force's priority target: the most dangerous enemy currently in sight, so
 *  units CONCENTRATE fire on it (coordination) rather than each plinking its own
 *  local best — concentration is what actually breaks a defender. */
function forcePriority(state: GameState, side: Side): UnitInstance | null {
  let best: UnitInstance | null = null;
  let bestThreat = -1;
  for (const s of visibleSightings(state, side)) {
    const live = state.units.find((u) => u.id === s.id && u.structure > 0);
    if (!live) continue;
    const w = unitType(live.typeId).weapons[0];
    const threat = (w ? w.damage * w.accuracy : 0) * (live.crits.includes("shaken") ? 0.2 : 1);
    if (threat > bestThreat) {
      bestThreat = threat;
      best = live;
    }
  }
  return best;
}

function doFire(state: GameState, unit: UnitInstance, priority: UnitInstance | null): void {
  const weapons = unitType(unit.typeId).weapons;
  // Concentrate on the force priority if this unit can meaningfully hit it.
  if (priority && priority.structure > 0) {
    for (let wi = 0; wi < weapons.length; wi++) {
      if (canAttack(state, unit, wi, priority) && shotValue(unit, unit.hex, priority) > 0) {
        attackUnit(state, unit, wi, priority);
        return;
      }
    }
  }
  // Otherwise the best worthwhile shot available to this unit.
  let bestTarget: UnitInstance | null = null;
  let bestWeapon = 0;
  let bestV = 0;
  for (const s of visibleSightings(state, unit.side)) {
    const live = state.units.find((u) => u.id === s.id && u.structure > 0);
    if (!live) continue;
    for (let wi = 0; wi < weapons.length; wi++) {
      if (!canAttack(state, unit, wi, live)) continue;
      const v = shotValue(unit, unit.hex, live);
      if (v > bestV) {
        bestV = v;
        bestTarget = live;
        bestWeapon = wi;
      }
    }
  }
  if (bestTarget && bestV > 0) attackUnit(state, unit, bestWeapon, bestTarget);
}

/** Artillery doctrine: when 2+ visible enemies sit inside one mission footprint,
 *  an area SUPPRESSION beats plinking a single target — saturation pressure is
 *  what cracks a position. Deterministic (sorted candidates, first-best wins). */
function tryFireMission(state: GameState, unit: UnitInstance): boolean {
  const visible = visibleSightings(state, unit.side);
  if (visible.length < 2) return false;
  const cands = [...visible].sort((a, b) => (hexKey(a.hex) < hexKey(b.hex) ? -1 : 1));
  let best: Hex | null = null;
  let bestN = 1;
  for (const s of cands) {
    const n = visible.filter((o) => hexDistance(o.hex, s.hex) <= RULES.mission.radius).length;
    if (n > bestN) {
      bestN = n;
      best = s.hex;
    }
  }
  if (!best || !canFireMission(state, unit, best, "suppress").ok) return false;
  return fireMission(state, unit, best, "suppress").ok;
}

/** Engineer doctrine: a DEFENDING engineer on a hold digs in — fortifying its
 *  position (cover for the line, slow going for the assault) is worth more than
 *  its demo charges. Attacking engineers keep moving and fighting. */
function tryFortify(state: GameState, unit: UnitInstance, task?: Task): boolean {
  if (unit.side === state.objective.attacker) return false;
  if (task && task.kind !== "hold" && task.kind !== "screen" && task.kind !== "rear") return false;
  if (!canFortify(state, unit, unit.hex).ok) return false;
  return fortifyHex(state, unit, unit.hex).ok;
}

function doResupply(state: GameState, unit: UnitInstance): void {
  // Resupply the neediest adjacent friendly (favour the spearhead — the mech).
  const adj = livingUnits(state, unit.side)
    .filter((t) => t.id !== unit.id && hexDistance(unit.hex, t.hex) === 1 && needsSupply(t))
    .sort((a, b) => (unitType(b.typeId).cls === "mech" ? 1 : 0) - (unitType(a.typeId).cls === "mech" ? 1 : 0));
  if (adj[0]) resupplyUnit(state, unit, adj[0]);
}

/** Decide + execute every eligible AI-controlled unit of a side, under a
 *  seeded force plan (varied, deterministic positioning + posture). */
export function commandForce(state: GameState, side: Side): void {
  const plan = planForce(state, side);
  for (const unit of livingUnits(state, side)) {
    if (unit.controller !== "ai" || !isEligible(state, unit)) continue;
    const task = plan.tasks.get(unit.id);
    const decision = decideUnit(state, unit, task);
    state.intents[unit.id] = decision.intent;
    if (decision.path.length) moveUnit(state, unit, decision.path);
    const cls = unitType(unit.typeId).cls;
    const action = ROLE[cls].action;
    // Recompute the priority after the move so concentration tracks the field.
    if (action === "fire") {
      // Support verbs first where doctrine says so, else aimed fire.
      if (cls === "artillery" && tryFireMission(state, unit)) continue;
      if (cls === "engineer" && tryFortify(state, unit, task)) continue;
      doFire(state, unit, forcePriority(state, side));
    } else if (action === "resupply") doResupply(state, unit);
  }
}
