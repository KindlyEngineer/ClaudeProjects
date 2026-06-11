import type { Side } from "../data/types";
import { terrain } from "../data/terrain";
import { unitType } from "../data/units";
import { canAttack, canClearMines, canFortify, canLayMines, missionWeaponIndex } from "../sim/actions";
import { hitChance } from "../sim/combat";
import { armorArc, hexDistance, hexEquals, neighbors, type Hex } from "../sim/hex";
import { needsSupply } from "../sim/logistics";
import { reachable, type ReachNode } from "../sim/pathing";
import { RULES } from "../data/rules";
import { temperamentOf } from "../data/temperaments";
import { canFire, canMove, cellAt, livingUnits, unitLabel, type GameState, type Sighting, type UnitInstance } from "../sim/state";
import { isEligible } from "../sim/turn";

// Pure interaction logic for the interactive UI — what the player may select and
// command right now, derived solely from sim state. No DOM, no THREE, so it's
// unit-testable. The DOM/Three controller (ui/interactive.ts) is a thin shell
// over these and the shared action API; it never reasons about rules itself.
//
// The brief's invariant lives here: the player may order ONLY their own units
// (controller === "player"); the mechs and the enemy are AI and can be inspected
// but never commanded. isPlayerControllable is the single gate for that.
// The fog invariant lives here too: everything the player learns about the enemy
// flows through their side's BELIEF (selectableUnitIdAt, inspectModel) — never
// ground truth.

export function isPlayerControllable(unit: UnitInstance): boolean {
  return unit.controller === "player";
}

/** Can this unit still do anything this activation — move or take its main
 *  action? (A unit that has both moved and acted is spent.) */
export function hasActivationLeft(unit: UnitInstance): boolean {
  return !unit.movedThisTurn || !unit.actedThisTurn;
}

/** "Ready" = the player can issue this unit an order right now: it's theirs, it's
 *  this unit's phase, and it hasn't spent its activation. Drives the bright/greyed
 *  state of cards and board markers. */
export function readyToOrder(state: GameState, unit: UnitInstance): boolean {
  return isPlayerControllable(unit) && isEligible(state, unit) && hasActivationLeft(unit);
}

/** May this unit be HELD IN RESERVE right now — skip its home phase to commit in
 *  the maneuver phase instead? Only before it has done anything this turn. */
export function canReserve(state: GameState, unit: UnitInstance): boolean {
  return (
    readyToOrder(state, unit) &&
    !unit.reserved &&
    state.phase !== "maneuver" &&
    !unit.movedThisTurn &&
    !unit.actedThisTurn
  );
}

/** The hexes this unit could still move to this activation (empty if it can't —
 *  already moved, immobilised, or not its phase). Excludes its current hex. */
export function moveOptions(state: GameState, unit: UnitInstance): Map<string, ReachNode> {
  const out = new Map<string, ReachNode>();
  if (!readyToOrder(state, unit) || unit.movedThisTurn || !canMove(unit)) return out;
  for (const [k, node] of reachable(state, unit)) if (node.prev !== null) out.set(k, node);
  return out;
}

/** The most effective weapon `unit` can legally fire at `target` right now:
 *  penetrating damage (weighted by hit chance) beats suppression-only; null if no
 *  weapon can engage. Keeps multi-weapon units from defaulting to a futile tube. */
export function bestWeaponIndex(state: GameState, unit: UnitInstance, target: UnitInstance): number | null {
  const weapons = unitType(unit.typeId).weapons;
  const tType = unitType(target.typeId);
  let best: number | null = null;
  let bestV = -1;
  for (let wi = 0; wi < weapons.length; wi++) {
    if (!canAttack(state, unit, wi, target)) continue;
    const w = weapons[wi];
    const arc = armorArc(target.hex, target.facing, unit.hex);
    const hc = hitChance(state, unit, w, target);
    const v = w.penetration >= tType.armor[arc] ? w.damage * hc : w.suppression * hc * 0.25;
    if (v > bestV) {
      bestV = v;
      best = wi;
    }
  }
  return best;
}

/** Visible enemies this unit can fire on right now → enemyId ⇒ the best weapon
 *  index to use. Empty if it can't shoot. (Legality — sight, range, ammo — is
 *  canAttack's; this only ranks the legal choices.) */
export function attackOptions(state: GameState, unit: UnitInstance): Map<number, number> {
  const out = new Map<number, number>();
  if (!readyToOrder(state, unit) || unit.actedThisTurn || !canFire(unit)) return out;
  const enemySide = unit.side === "blue" ? "red" : "blue";
  for (const e of livingUnits(state, enemySide)) {
    const wi = bestWeaponIndex(state, unit, e);
    if (wi !== null) out.set(e.id, wi);
  }
  return out;
}

export interface AttackPreview {
  id: number; // target unit id
  weaponIndex: number;
  hex: Hex; // where to draw the label
  hitPct: number; // 0..100, what the to-hit roll actually uses
}

/** Hit-chance preview for every current attack option (BattleTech-style "62%"
 *  over each target) — computed with the same hitChance the roll will use. */
export function attackPreviews(state: GameState, unit: UnitInstance): AttackPreview[] {
  const out: AttackPreview[] = [];
  for (const [id, weaponIndex] of attackOptions(state, unit)) {
    const target = livingUnits(state).find((u) => u.id === id);
    if (!target) continue;
    const w = unitType(unit.typeId).weapons[weaponIndex];
    out.push({ id, weaponIndex, hex: target.hex, hitPct: Math.round(hitChance(state, unit, w, target) * 100) });
  }
  return out;
}

/** Which SUPPORT VERBS this unit could use right now (drives the bar buttons —
 *  target validity is the action's own gate, checked on the click). */
export function supportActions(
  state: GameState,
  unit: UnitInstance,
): { missions: boolean; fortify: boolean; mine: boolean; clear: boolean; decoy: boolean } {
  if (!readyToOrder(state, unit) || unit.actedThisTurn)
    return { missions: false, fortify: false, mine: false, clear: false, decoy: false };
  const wi = missionWeaponIndex(unit);
  const missions =
    wi !== null && canFire(unit) && unit.dryTurns < RULES.dryFireTurns && unit.ammo[wi] >= RULES.mission.ammoCost;
  const engineer = unitType(unit.typeId).cls === "engineer";
  const ew = unitType(unit.typeId).cls === "ew";
  return {
    missions,
    fortify: engineer,
    mine: engineer && mineTargets(state, unit).length > 0,
    clear: engineer && clearTargets(state, unit).length > 0,
    decoy: ew && unit.ewCharges > 0 && !unit.crits.includes("sensors"),
  };
}

/** Hexes this engineer could MINE right now (own + adjacent, lay rules). */
export function mineTargets(state: GameState, unit: UnitInstance): Hex[] {
  if (!readyToOrder(state, unit)) return [];
  return [unit.hex, ...neighbors(unit.hex)].filter((h) => canLayMines(state, unit, h).ok);
}

/** Adjacent hostile minefields this engineer could BREACH right now. */
export function clearTargets(state: GameState, unit: UnitInstance): Hex[] {
  if (!readyToOrder(state, unit)) return [];
  return [unit.hex, ...neighbors(unit.hex)].filter((h) => canClearMines(state, unit, h).ok);
}

/** Hexes this engineer could fortify right now (its own + adjacent). */
export function fortifyTargets(state: GameState, unit: UnitInstance): Hex[] {
  if (!readyToOrder(state, unit)) return [];
  return [unit.hex, ...neighbors(unit.hex)].filter((h) => canFortify(state, unit, h).ok);
}

/** Adjacent friendly units this supply unit could resupply right now. */
export function resupplyOptions(state: GameState, unit: UnitInstance): Set<number> {
  const out = new Set<number>();
  if (!readyToOrder(state, unit) || unit.actedThisTurn) return out;
  if (unitType(unit.typeId).cls !== "supply" || unit.supply <= 0) return out;
  for (const t of livingUnits(state, unit.side)) {
    if (t.id !== unit.id && hexDistance(unit.hex, t.hex) === 1 && needsSupply(t)) out.add(t.id);
  }
  return out;
}

/** The unit id a click on `hex` may select, AS SEEN BY `side`: own units by
 *  ground truth; enemies only where this side BELIEVES them to be (a remembered
 *  ghost selects at its last-known hex; an unscouted enemy is unselectable —
 *  selection must never leak what the side hasn't seen). */
export function selectableUnitIdAt(state: GameState, side: Side, hex: Hex): number | null {
  for (const u of livingUnits(state, side)) if (hexEquals(u.hex, hex)) return u.id;
  for (const s of state.belief[side].values()) if (hexEquals(s.hex, hex)) return s.id;
  return null;
}

export interface CardModel {
  id: number;
  side: Side;
  abbr: string;
  name: string; // call sign for mechs, else the type name
  subtitle: string | null; // the type name when `name` is a call sign
  controllable: boolean; // player-ordered (vs AI mech / enemy)
  ready: boolean; // actionable this phase → bright; else greyed
  reserved: boolean; // held to commit in the maneuver phase
  structureFrac: number;
  fuelFrac: number;
  ammoFrac: number;
  suppressionFrac: number; // 0..1 toward morale break
  inSupply: boolean;
  crits: string[]; // active crit states (mobility / weapon / sensors / shaken)
  intent: string | null; // AI mech's current commander intent, if any
}

/** Display model for one unit's info card (pure derivation of sim state). */
export function cardModel(state: GameState, unit: UnitInstance): CardModel {
  const t = unitType(unit.typeId);
  const ammoMax = t.weapons.reduce((s, w) => s + w.ammoMax, 0);
  const ammoNow = unit.ammo.reduce((s, a) => s + a, 0);
  return {
    id: unit.id,
    side: unit.side,
    abbr: t.cls.charAt(0).toUpperCase(),
    name: unitLabel(unit),
    subtitle: unit.callSign ? `${t.name}${temperamentOf(unit.callSign) ? " · " + temperamentOf(unit.callSign)!.name : ""}` : null,
    controllable: isPlayerControllable(unit),
    ready: readyToOrder(state, unit),
    reserved: unit.reserved,
    structureFrac: Math.max(0, unit.structure / t.structure),
    fuelFrac: t.fuelMax ? unit.fuel / t.fuelMax : 1,
    ammoFrac: ammoMax ? ammoNow / ammoMax : 1,
    suppressionFrac: Math.min(1, unit.suppression / RULES.suppressionBreak),
    inSupply: unit.inSupply,
    crits: [...unit.crits],
    intent: t.cls === "mech" ? (state.intents[unit.id] ?? null) : null,
  };
}

/** The cards to show: the player's whole force (their side), ordered support
 *  first (the units they actually command) then the AI mechs. Enemy units aren't
 *  listed — the player only knows them through what's on the board (fog of war). */
export function forceCards(state: GameState, side: Side): CardModel[] {
  return livingUnits(state, side)
    .map((u) => cardModel(state, u))
    .sort((a, b) => Number(b.controllable) - Number(a.controllable) || a.id - b.id);
}

// ── Inspection (the panel for whatever is selected / clicked) ─────────────────

export interface TerrainInfo {
  name: string;
  cover: number;
  moveCost: number;
  blocksLineOfSight: boolean;
  elevation: number; // visual in v0 (cover comes from terrain TYPE)
}

export type InspectModel =
  | {
      kind: "own";
      card: CardModel;
      suppression: number;
      terrain: TerrainInfo | null;
      components: Array<{ name: string; lost: boolean }>; // M2.5 detail readout
    }
  | {
      kind: "enemy"; // built from BELIEF only — never ground truth
      id: number;
      name: string;
      abbr: string;
      side: Side;
      structureFrac: number;
      crits: string[];
      live: boolean; // in sight right now (false = remembered ghost)
      lastSeenTurn: number;
      terrain: TerrainInfo | null; // at the BELIEVED hex
    }
  | { kind: "terrain"; terrain: TerrainInfo; hex: Hex }
  | null;

export function terrainInfo(state: GameState, hex: Hex): TerrainInfo | null {
  const cell = cellAt(state, hex);
  if (!cell) return null;
  const t = terrain(cell.terrain);
  return { name: t.name, cover: t.cover, moveCost: t.moveCost, blocksLineOfSight: t.blocksLineOfSight, elevation: cell.elevation };
}

function enemyInspect(state: GameState, s: Sighting): InspectModel {
  const t = unitType(s.typeId);
  return {
    kind: "enemy",
    id: s.id,
    name: t.name,
    abbr: t.cls.charAt(0).toUpperCase(),
    side: s.side,
    structureFrac: Math.max(0, s.structure / t.structure),
    crits: [...s.crits],
    live: s.visibleNow,
    lastSeenTurn: s.lastSeenTurn,
    terrain: terrainInfo(state, s.hex),
  };
}

/** What the inspect panel shows `viewSide`: a selected own unit (full data), a
 *  selected enemy (that side's belief ONLY — last-known state, flagged stale when
 *  out of sight), or the terrain of a clicked empty hex. */
export function inspectModel(state: GameState, viewSide: Side, selectedId: number | null, hex: Hex | null): InspectModel {
  if (selectedId !== null) {
    const own = livingUnits(state, viewSide).find((u) => u.id === selectedId);
    if (own) {
      const components = unitType(own.typeId).components.map((comp) => ({
        name: comp.name,
        lost: own.componentsLost.includes(comp.id),
      }));
      return { kind: "own", card: cardModel(state, own), suppression: own.suppression, terrain: terrainInfo(state, own.hex), components };
    }
    const sighting = state.belief[viewSide].get(selectedId);
    if (sighting) return enemyInspect(state, sighting);
    return null; // selected something this side doesn't know — show nothing
  }
  if (hex) {
    const t = terrainInfo(state, hex);
    if (t) return { kind: "terrain", terrain: t, hex };
  }
  return null;
}
