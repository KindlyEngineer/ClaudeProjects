import { mapById, OPERATIONS } from "../data/operations";
import { RULES } from "../data/rules";
import { terrain } from "../data/terrain";
import type { MapDef, OperationDef, Stockpile, UnitPlacement } from "../data/types";
import { unitType } from "../data/units";
import { hexDistance, hexKey, type Hex } from "./hex";
import { CALL_SIGNS, createGame, type GameState, type UnitInstance } from "./state";
import { clampTrust, trustBand } from "./trust";

// The operation layer (M1): a linked battle sequence with FULL CARRY-OVER
// (owner ruling D1) and the Interlude between battles. Pure + serializable —
// the whole OperationState round-trips through JSON for the checkpoint save.
//
// The division of labour mirrors the battlefield rule exactly:
//   · the PLAYER spends the stockpile on their own support echelon and decides
//     what stays in the depot;
//   · the COMMANDER refits its mechs from the depot, by itself, legibly.
// Provision, never task. Mech death is permanent (ruling): a requisition fields
// a fully NEW named entity — fresh call sign, commander-chosen chassis.

export interface UnitRecord {
  typeId: string;
  callSign?: string;
  alive: boolean;
  structure: number;
  ammo: number[];
  fuel: number;
  crits: string[];
  componentsLost: string[]; // M2.5 — damage is component-deep across battles
  committed?: boolean; // M2.6 — has fought a battle (a veteran can't be disbanded)
}

export interface BattleRecord {
  title: string;
  won: boolean;
  turns: number;
  mechsLost: string[]; // call signs that died (they stay dead)
  enemyDestroyed: string[]; // enemy unit type NAMES confirmed killed this battle (H2)
}

export interface OperationState {
  defId: string;
  seed: number;
  battleIndex: number; // the battle being prepared / fought
  phase: "interlude" | "battle" | "done";
  outcome: "ongoing" | "complete" | "failed";
  stockpile: Stockpile;
  nextOffmap: { strike: number; recon: number }; // sorties assigned to the coming battle
  roster: UnitRecord[]; // the persistent blue task force
  usedCallSigns: string[]; // includes the dead — a name is never reissued
  refitReport: string[]; // the commander's last Interlude report (legible)
  history: BattleRecord[];
  trust: Record<string, number>; // call sign → 0..100 confidence in the support (D13)
  trustNotes: string[]; // the last battle's trust ledger, in the commanders' words
  /** The PERSISTENT enemy formation (H2): every battle fields what's LEFT of
   *  it. Kill a tank in battle one and it isn't waiting in battle three —
   *  attrition becomes operational work, and reading their remaining strength
   *  becomes operational intel. */
  enemy: UnitRecord[];
}

export function operationDef(op: OperationState): OperationDef {
  const def = OPERATIONS[op.defId];
  if (!def) throw new Error(`unknown operation '${op.defId}'`);
  return def;
}

function fullRecord(typeId: string, callSign?: string): UnitRecord {
  const t = unitType(typeId);
  return {
    typeId,
    callSign,
    alive: true,
    structure: t.structure,
    ammo: t.weapons.map((w) => w.ammoMax),
    fuel: t.fuelMax,
    crits: [],
    componentsLost: [],
  };
}

/** Recompute the derived crit states from what's still broken (shaken is
 *  transient and never carries between battles). */
function recomputeCrits(r: UnitRecord): void {
  const t = unitType(r.typeId);
  const lost = (effect: string) => t.components.some((c) => c.effect === effect && r.componentsLost.includes(c.id));
  const crits: string[] = [];
  if (lost("mobility")) crits.push("mobility");
  if (lost("sensors")) crits.push("sensors");
  const allWeapons =
    t.weapons.length > 0 &&
    t.weapons.every((_, wi) => t.components.some((c) => c.effect === "weapon" && c.weaponIndex === wi && r.componentsLost.includes(c.id)));
  if (allWeapons) crits.push("weapon");
  r.crits = crits;
}

/** Start an operation: the roster holds the COMMANDER's mechs (fixed by the
 *  operation); the player COMPOSES the support echelon from scratch in the
 *  staging Interlude (M2.6 — credits + cap), then deploys it each battle. */
export function createOperation(defId: string, seed: number): OperationState {
  const def = OPERATIONS[defId];
  if (!def) throw new Error(`unknown operation '${defId}'`);
  const mechSpots = mapById(def.battles[0].mapId).units.filter((p) => p.side === "blue" && unitType(p.type).cls === "mech");
  let signs = 0;
  const roster = mechSpots.map((p) => fullRecord(p.type, CALL_SIGNS[signs++ % CALL_SIGNS.length]));
  const trust: Record<string, number> = {};
  for (const r of roster) if (r.callSign) trust[r.callSign] = RULES.trust.start;
  // The enemy FORMATION (H2): per type, the largest contingent any battle
  // fields — so every battle opens fully manned unless the player has already
  // thinned it. Battles draw from the survivors; the dead are not replaced.
  const enemyCounts = new Map<string, number>();
  for (const b of def.battles) {
    const local = new Map<string, number>();
    for (const p of mapById(b.mapId).units) if (p.side === "red") local.set(p.type, (local.get(p.type) ?? 0) + 1);
    for (const [t, n] of local) enemyCounts.set(t, Math.max(enemyCounts.get(t) ?? 0, n));
  }
  const enemy = [...enemyCounts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .flatMap(([t, n]) => Array.from({ length: n }, () => fullRecord(t)));
  return {
    defId,
    seed,
    battleIndex: 0,
    phase: "interlude",
    outcome: "ongoing",
    stockpile: { ...def.initialStockpile },
    nextOffmap: { strike: 0, recon: 0 },
    roster,
    usedCallSigns: roster.filter((r) => r.callSign).map((r) => r.callSign!),
    refitReport: [],
    history: [],
    trust,
    trustNotes: [],
    enemy,
  };
}

// ── Trust (Horizon 2, ruling D13) ─────────────────────────────────────────────

/** A call sign's current trust in the support (start value when unrecorded —
 *  also covers checkpoints saved before trust existed). */
export function trustOf(op: OperationState, callSign: string | undefined): number {
  if (!callSign) return RULES.trust.start;
  return op.trust?.[callSign] ?? RULES.trust.start;
}

function adjustTrust(op: OperationState, callSign: string, delta: number): number {
  const now = clampTrust(trustOf(op, callSign) + delta);
  op.trust = { ...(op.trust ?? {}), [callSign]: now };
  return now;
}

// ── The Interlude (player provisioning + the commander's refit) ───────────────

const CRIT_REPAIR_COST = 5; // repair points to clear one crit

/** Spend stockpile on one of the PLAYER'S OWN support units. Mechs are not
 *  spendable here — the commander handles its own from the depot. */
export function spendOnSupport(
  op: OperationState,
  rosterIndex: number,
  spend: { repair?: number; ammo?: number; fuel?: number },
): { ok: boolean; reason?: string } {
  const r = op.roster[rosterIndex];
  if (!r || !r.alive) return { ok: false, reason: "no such unit" };
  if (unitType(r.typeId).cls === "mech") return { ok: false, reason: "the commander manages its mechs" };
  const t = unitType(r.typeId);

  const repair = Math.min(spend.repair ?? 0, op.stockpile.repair, t.structure - r.structure);
  r.structure += repair;
  op.stockpile = { ...op.stockpile, repair: op.stockpile.repair - repair };

  let ammoLeft = Math.min(spend.ammo ?? 0, op.stockpile.ammo);
  const spent = { ammo: 0 };
  for (let i = 0; i < r.ammo.length && ammoLeft > 0; i++) {
    const give = Math.min(t.weapons[i].ammoMax - r.ammo[i], ammoLeft);
    r.ammo[i] += give;
    ammoLeft -= give;
    spent.ammo += give;
  }
  op.stockpile = { ...op.stockpile, ammo: op.stockpile.ammo - spent.ammo };

  const fuel = Math.min(spend.fuel ?? 0, op.stockpile.fuel, t.fuelMax - r.fuel);
  r.fuel += fuel;
  op.stockpile = { ...op.stockpile, fuel: op.stockpile.fuel - fuel };

  // The bench restores broken COMPONENTS once the hull is whole.
  while (r.componentsLost.length > 0 && op.stockpile.repair >= CRIT_REPAIR_COST && r.structure >= t.structure) {
    r.componentsLost.pop();
    op.stockpile = { ...op.stockpile, repair: op.stockpile.repair - CRIT_REPAIR_COST };
  }
  recomputeCrits(r);
  return { ok: true };
}

/** Assign air sorties from the stockpile to the coming battle. */
export function assignSorties(op: OperationState, strike: number, recon: number): { ok: boolean; reason?: string } {
  if (strike < 0 || recon < 0) return { ok: false, reason: "invalid" };
  if (strike > op.stockpile.strikes || recon > op.stockpile.recon) return { ok: false, reason: "not enough sorties" };
  op.stockpile = { ...op.stockpile, strikes: op.stockpile.strikes - strike, recon: op.stockpile.recon - recon };
  op.nextOffmap = { strike: op.nextOffmap.strike + strike, recon: op.nextOffmap.recon + recon };
  return { ok: true };
}

/** Requisition a NEW mech (mech death is permanent — this is a different
 *  machine and a different name). The COMMANDER picks the chassis: whatever
 *  class the force now lacks most. High cost by design. */
export function requisitionMech(op: OperationState): { ok: boolean; reason?: string; callSign?: string } {
  const def = operationDef(op);
  if (op.stockpile.credits < def.mechPrice) return { ok: false, reason: "not enough credits" };
  const sign = CALL_SIGNS.find((c) => !op.usedCallSigns.includes(c));
  if (!sign) return { ok: false, reason: "no call signs left" };
  const living = op.roster.filter((r) => r.alive && unitType(r.typeId).cls === "mech");
  const pool = ["mech_assault", "mech_scout", "mech_fire"]; // the commander's yard
  const counts = pool.map((id) => living.filter((r) => r.typeId === id).length);
  const typeId = pool[counts.indexOf(Math.min(...counts))]; // fill the thinnest role
  op.roster.push(fullRecord(typeId, sign));
  op.usedCallSigns.push(sign);
  op.stockpile = { ...op.stockpile, credits: op.stockpile.credits - def.mechPrice };
  op.trust = { ...(op.trust ?? {}), [sign]: RULES.trust.start }; // a recruit arrives with no history
  return { ok: true, callSign: sign };
}

// ── Force composition (M2.6 — compose once, reinforce after) ──────────────────

/** Living player-controlled support units on the books (the cap counts these). */
export function supportCount(op: OperationState): number {
  return op.roster.filter((r) => r.alive && unitType(r.typeId).cls !== "mech").length;
}

export function catalogPrice(op: OperationState, typeId: string): number | undefined {
  return operationDef(op).supportCatalog.find((c) => c.type === typeId)?.price;
}

/** BUY a support unit from the operation's catalog into the echelon (staging
 *  composition and later reinforcement use the same verb). Credits + hard cap. */
export function buySupport(op: OperationState, typeId: string): { ok: boolean; reason?: string } {
  const def = operationDef(op);
  const price = catalogPrice(op, typeId);
  if (price === undefined) return { ok: false, reason: "not in the catalog" };
  if (supportCount(op) >= def.supportCap) return { ok: false, reason: `force cap reached (${def.supportCap})` };
  if (op.stockpile.credits < price) return { ok: false, reason: "not enough credits" };
  op.roster.push(fullRecord(typeId));
  op.stockpile = { ...op.stockpile, credits: op.stockpile.credits - price };
  return { ok: true };
}

/** DISBAND an un-fought purchase for a full refund. Veterans (any unit that has
 *  seen a battle) can't be disbanded — they're yours now. */
export function disbandSupport(op: OperationState, rosterIndex: number): { ok: boolean; reason?: string } {
  const r = op.roster[rosterIndex];
  if (!r || !r.alive) return { ok: false, reason: "no such unit" };
  if (unitType(r.typeId).cls === "mech") return { ok: false, reason: "the mechs are not yours to dismiss" };
  if (r.committed) return { ok: false, reason: "veterans are not disbanded" };
  const price = catalogPrice(op, r.typeId) ?? 0;
  op.roster.splice(rosterIndex, 1);
  op.stockpile = { ...op.stockpile, credits: op.stockpile.credits + price };
  return { ok: true };
}

/** The commander refits its OWN mechs from whatever the player left in the
 *  depot — hull first, then jammed systems, then magazines and tanks. Returns
 *  the legible report (and requests, when the depot ran short). */
export function commanderRefit(op: OperationState): string[] {
  const report: string[] = [];
  const mechs = op.roster.filter((r) => r.alive && unitType(r.typeId).cls === "mech");
  for (const m of mechs) {
    const t = unitType(m.typeId);
    const name = m.callSign ?? t.name;
    const lines: string[] = [];

    const need = t.structure - m.structure;
    const repair = Math.min(need, op.stockpile.repair);
    if (repair > 0) {
      m.structure += repair;
      op.stockpile = { ...op.stockpile, repair: op.stockpile.repair - repair };
      lines.push(`hull +${repair}`);
    }
    if (m.structure < t.structure) lines.push(`REQUEST: ${t.structure - m.structure} more repair`);

    while (m.componentsLost.length > 0 && op.stockpile.repair >= CRIT_REPAIR_COST) {
      const compId = m.componentsLost.pop()!;
      const comp = t.components.find((c) => c.id === compId);
      op.stockpile = { ...op.stockpile, repair: op.stockpile.repair - CRIT_REPAIR_COST };
      lines.push(`${comp?.name ?? compId} restored`);
    }
    recomputeCrits(m);
    if (m.componentsLost.length > 0) {
      const names = m.componentsLost.map((id) => t.components.find((c) => c.id === id)?.name ?? id);
      lines.push(`REQUEST: repair for ${names.join(", ")}`);
    }

    let rounds = 0;
    for (let i = 0; i < m.ammo.length; i++) {
      const give = Math.min(t.weapons[i].ammoMax - m.ammo[i], op.stockpile.ammo);
      m.ammo[i] += give;
      rounds += give;
      op.stockpile = { ...op.stockpile, ammo: op.stockpile.ammo - give };
    }
    if (rounds > 0) lines.push(`+${rounds} rounds`);
    if (m.ammo.some((a, i) => a < t.weapons[i].ammoMax)) lines.push("REQUEST: more ammunition");

    const fuel = Math.min(t.fuelMax - m.fuel, op.stockpile.fuel);
    if (fuel > 0) {
      m.fuel += fuel;
      op.stockpile = { ...op.stockpile, fuel: op.stockpile.fuel - fuel };
      lines.push(`+${fuel} fuel`);
    }
    if (m.fuel < t.fuelMax) lines.push("REQUEST: more fuel");

    // Trust answers the refit (D13): every request the depot couldn't meet costs
    // it; walking out combat ready earns it. The ledger is part of the report.
    const requests = lines.filter((l) => l.startsWith("REQUEST")).length;
    const delta = requests > 0 ? requests * RULES.trust.deltas.unmetRequest : RULES.trust.deltas.fullRefit;
    let body = lines.length ? lines.join(" · ") : "combat ready";
    if (m.callSign) {
      const now = adjustTrust(op, m.callSign, delta);
      body += ` · trust ${delta > 0 ? "+" : ""}${delta} → ${now} (${trustBand(now)})`;
    }
    report.push(`${name}: ${body}`);
  }
  return report;
}

/** Close the Interlude: the commander draws from the depot, the report is
 *  filed, and the next battle begins. */
export function finishInterlude(op: OperationState): void {
  op.refitReport = commanderRefit(op);
  op.phase = "battle";
}

// ── Battle preparation + recording (the carry-over itself) ────────────────────

/** The player's DEPLOYMENT ZONE for a battle (M2.6): the map's authored zone if
 *  present, else derived — the home band when blue attacks, the objective's
 *  neighbourhood when blue defends. Passable hexes only. */
export function deriveDeployZone(map: MapDef): Hex[] {
  if (map.deployZone) return map.deployZone.map((h) => ({ ...h }));
  const passable = map.cells.filter((c) => Number.isFinite(terrain(c.terrain).moveCost));
  if (map.objective.attacker === "blue") {
    const minQ = Math.min(...map.cells.map((c) => c.hex.q));
    return passable.filter((c) => c.hex.q <= minQ + 3).map((c) => ({ ...c.hex }));
  }
  const zone = map.objective.zone;
  const cq = Math.round(zone.reduce((s, h) => s + h.q, 0) / Math.max(1, zone.length));
  const cr = Math.round(zone.reduce((s, h) => s + h.r, 0) / Math.max(1, zone.length));
  return passable.filter((c) => hexDistance(c.hex, { q: cq, r: cr }) <= 4).map((c) => ({ ...c.hex }));
}

/** Build the next battle's GameState (M2.6 shape): the COMMANDER's mechs take
 *  the map's mech slots (carry-over + replacements as before); the player's
 *  COMPOSED echelon spawns into the deployment zone at default positions, with
 *  `deployPending` set so the UI runs the placement step before turn one. */
export function prepareBattle(op: OperationState): GameState {
  const def = operationDef(op);
  const battle = def.battles[op.battleIndex];
  const map = mapById(battle.mapId);
  const offmap = {
    blue: {
      strike: (map.offmap?.blue?.strike ?? 0) + op.nextOffmap.strike,
      recon: (map.offmap?.blue?.recon ?? 0) + op.nextOffmap.recon,
    },
    red: map.offmap?.red ?? {},
  };
  op.nextOffmap = { strike: 0, recon: 0 }; // assigned sorties fly this battle or not at all
  // Blue keeps only its MECH slots from the map — the support echelon is the
  // player's composition, not the scenario author's.
  const units = map.units.filter((p) => p.side !== "blue" || unitType(p.type).cls === "mech");
  const state = createGame({ ...map, offmap, units }, op.seed * 31 + op.battleIndex + 1);

  // Mech slots ← living mech records: same-type first, replacements after.
  const blueMechs = state.units.filter((u) => u.side === "blue");
  const unmatched: UnitInstance[] = [];
  const used = new Set<number>();
  const matchOf = new Map<number, number>(); // unit id → roster index
  for (const u of blueMechs) {
    const idx = op.roster.findIndex((r, i) => !used.has(i) && r.alive && r.typeId === u.typeId);
    if (idx >= 0) {
      used.add(idx);
      matchOf.set(u.id, idx);
    } else unmatched.push(u);
  }
  const spareMechs = op.roster
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => !used.has(i) && r.alive && unitType(r.typeId).cls === "mech");
  for (const u of unmatched.slice()) {
    if (spareMechs.length === 0) break;
    const { r, i } = spareMechs.shift()!;
    used.add(i);
    const t = unitType(r.typeId); // a replacement chassis takes the vacant slot
    u.typeId = r.typeId;
    u.structure = t.structure;
    u.ammo = t.weapons.map((w) => w.ammoMax);
    u.fuel = t.fuelMax;
    matchOf.set(u.id, i);
    unmatched.splice(unmatched.indexOf(u), 1);
  }
  state.units = state.units.filter((u) => u.side !== "blue" || !unmatched.includes(u));

  // The persistent ENEMY (H2): red slots ← living enemy records, same-type
  // matching. A slot with nobody left to man it stands EMPTY — the player's
  // earlier attrition is felt here. No spare-chassis substitution: the enemy
  // fields what the scenario calls for or goes without.
  if (op.enemy?.length) {
    const usedE = new Set<number>();
    const matchE = new Map<number, number>();
    const ghosts: UnitInstance[] = [];
    for (const u of state.units.filter((x) => x.side === "red")) {
      const idx = op.enemy.findIndex((r, i) => !usedE.has(i) && r.alive && r.typeId === u.typeId);
      if (idx >= 0) {
        usedE.add(idx);
        matchE.set(u.id, idx);
      } else ghosts.push(u); // nobody left of this type — the slot stays empty
    }
    state.units = state.units.filter((u) => u.side !== "red" || !ghosts.includes(u));
    for (const u of state.units) {
      const idx = matchE.get(u.id);
      if (idx === undefined) continue;
      const r = op.enemy[idx];
      u.structure = r.structure;
      u.crits = [...r.crits];
      u.componentsLost = [...r.componentsLost];
      u.enemyRosterIndex = idx; // ammo/fuel arrive topped up — they refit too
    }
  }

  // The composed echelon spawns into the deployment zone (default spread; the
  // player repositions before turn one).
  const zone = deriveDeployZone(map);
  state.deployZone = zone.map((h) => ({ ...h }));
  state.deployPending = true;
  const taken = new Set(state.units.filter((u) => u.structure > 0).map((u) => hexKey(u.hex)));
  const spots = zone.filter((h) => !taken.has(hexKey(h))).sort((a, b) => (hexKey(a) < hexKey(b) ? -1 : 1));
  let nextId = Math.max(0, ...state.units.map((u) => u.id)) + 1;
  const facing = map.objective.attacker === "blue" ? 0 : 0; // blue faces east either way (red home = max q)
  op.roster.forEach((r, idx) => {
    if (!r.alive || unitType(r.typeId).cls === "mech") return;
    const hex = spots.shift();
    if (!hex) return; // a full zone shelves the overflow — the cap keeps this theoretical
    state.units.push({
      id: nextId++,
      typeId: r.typeId,
      side: "blue",
      controller: "player",
      hex: { ...hex },
      facing,
      structure: r.structure,
      ammo: [...r.ammo],
      fuel: r.fuel,
      suppression: 0,
      crits: [...r.crits],
      componentsLost: [...r.componentsLost],
      supply: unitType(r.typeId).supplyCapacity ?? 0,
      ewCharges: unitType(r.typeId).ewCharges ?? 0, // decoys recharge each battle (a consumable, like sorties)
      movedThisTurn: false,
      actedThisTurn: false,
      reserved: false,
      inSupply: true,
      dryTurns: 0,
      userRosterIndex: idx,
    });
    taken.add(hexKey(hex));
  });

  // Carry the records onto the fielded mechs.
  for (const u of state.units) {
    const idx = matchOf.get(u.id);
    if (idx === undefined) continue;
    const r = op.roster[idx];
    u.structure = r.structure;
    u.ammo = [...r.ammo];
    u.fuel = r.fuel;
    u.crits = [...r.crits];
    u.componentsLost = [...r.componentsLost];
    if (r.callSign) {
      u.callSign = r.callSign;
      u.trust = trustOf(op, r.callSign); // the operation's history rides into battle (D13)
    }
    u.userRosterIndex = idx;
  }
  return state;
}

/** Capture the battle's end state back into the roster and advance the
 *  operation (failure-forward: a non-final loss is carried, not retried). */
export function recordBattle(op: OperationState, state: GameState): void {
  const def = operationDef(op);
  const battle = def.battles[op.battleIndex];
  const won = state.outcome === "blue";

  const mechsLost: string[] = [];
  for (const u of state.units) {
    const idx = u.userRosterIndex;
    if (idx === undefined) continue;
    const r = op.roster[idx];
    r.alive = u.structure > 0;
    r.structure = u.structure;
    r.ammo = [...u.ammo];
    r.fuel = u.fuel;
    r.componentsLost = [...u.componentsLost];
    r.committed = true; // it has fought — a veteran now (no disbanding, M2.6)
    recomputeCrits(r); // shaken doesn't follow you home
    if (!r.alive && r.callSign) mechsLost.push(r.callSign);
  }

  // The enemy's ledger (H2): capture what the battle did to THEIR formation.
  // The fallen are confirmed (the field is yours to read after the fight);
  // survivors lick their wounds — full resupply, HALF the hull damage repaired,
  // broken components stay broken (their bench is at the front too).
  const enemyDestroyed: string[] = [];
  for (const u of state.units) {
    const idx = u.enemyRosterIndex;
    if (idx === undefined) continue;
    const r = op.enemy[idx];
    r.alive = u.structure > 0;
    r.structure = u.structure;
    r.componentsLost = [...u.componentsLost];
    recomputeCrits(r);
    if (!r.alive) enemyDestroyed.push(unitType(r.typeId).name);
    else {
      const t = unitType(r.typeId);
      r.structure = Math.min(t.structure, r.structure + Math.ceil((t.structure - r.structure) / 2));
      r.ammo = t.weapons.map((w) => w.ammoMax);
      r.fuel = t.fuelMax;
    }
  }

  // The trust ledger (D13): each surviving mech scores THIS battle by what it
  // lived — the outcome, the resupply runs that actually reached it, whether it
  // ended starved, and the names that didn't come back. Legible, line by line.
  const D = RULES.trust.deltas;
  op.trustNotes = [];
  for (const u of state.units) {
    if (!u.callSign || u.side !== "blue" || u.userRosterIndex === undefined || u.structure <= 0) continue;
    const t = unitType(u.typeId);
    const why: string[] = [won ? "we won" : "we were repulsed"];
    let delta = won ? D.win : D.loss;
    const runs = state.events.filter((e) => e.kind === "resupply" && e.targetId === u.id).length;
    if (runs > 0) {
      delta += Math.min(runs * D.resupplyEach, D.resupplyCap);
      why.push(`${runs} resupply ${runs === 1 ? "run" : "runs"} reached me`);
    }
    const starved = !u.inSupply || (t.weapons.length > 0 && u.ammo.every((a) => a === 0));
    if (starved) {
      delta += D.endedStarved;
      why.push(!u.inSupply ? "I ended it cut off" : "I ended it dry");
    }
    if (mechsLost.length > 0) {
      delta += mechsLost.length * D.mechLost;
      why.push(`we lost ${mechsLost.join(", ")}`);
    }
    const now = adjustTrust(op, u.callSign, delta);
    op.trustNotes.push(`${u.callSign}: trust ${delta > 0 ? "+" : ""}${delta} → ${now} (${trustBand(now)}) — ${why.join("; ")}`);
  }

  const award = won ? battle.award.win : battle.award.loss;
  op.stockpile = {
    ammo: op.stockpile.ammo + (award.ammo ?? 0),
    fuel: op.stockpile.fuel + (award.fuel ?? 0),
    repair: op.stockpile.repair + (award.repair ?? 0),
    strikes: op.stockpile.strikes + (award.strikes ?? 0),
    recon: op.stockpile.recon + (award.recon ?? 0),
    credits: op.stockpile.credits + (award.credits ?? 0),
  };
  op.history.push({ title: battle.title, won, turns: state.turn, mechsLost, enemyDestroyed });

  const mechsLeft = op.roster.some((r) => r.alive && unitType(r.typeId).cls === "mech");
  const finalBattle = op.battleIndex === def.battles.length - 1;
  if (!mechsLeft || (finalBattle && !won)) {
    op.phase = "done";
    op.outcome = "failed";
  } else if (finalBattle) {
    op.phase = "done";
    op.outcome = "complete";
  } else {
    op.battleIndex += 1;
    op.phase = "interlude";
  }
}

// The roster links travel on the unit so recording survives serialization-free.
declare module "./state" {
  interface UnitInstance {
    userRosterIndex?: number;
    enemyRosterIndex?: number; // red unit → op.enemy index (H2 persistent enemy)
  }
}

/** Placement helper kept for tests: blue slots of a map in placement order. */
export function blueSlots(mapId: string): UnitPlacement[] {
  return mapById(mapId).units.filter((p) => p.side === "blue");
}
