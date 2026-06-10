import { mapById, OPERATIONS } from "../data/operations";
import type { OperationDef, Stockpile, UnitPlacement } from "../data/types";
import { unitType } from "../data/units";
import { CALL_SIGNS, createGame, type GameState, type UnitInstance } from "./state";

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
}

export interface BattleRecord {
  title: string;
  won: boolean;
  turns: number;
  mechsLost: string[]; // call signs that died (they stay dead)
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
  };
}

/** Start an operation: the roster is battle 1's blue force at full strength,
 *  and the player begins at the STAGING Interlude (allocate before fighting). */
export function createOperation(defId: string, seed: number): OperationState {
  const def = OPERATIONS[defId];
  if (!def) throw new Error(`unknown operation '${defId}'`);
  const blue = mapById(def.battles[0].mapId).units.filter((p) => p.side === "blue");
  let signs = 0;
  const roster = blue.map((p) =>
    fullRecord(p.type, unitType(p.type).cls === "mech" ? CALL_SIGNS[signs++ % CALL_SIGNS.length] : undefined),
  );
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
  };
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

  // Repairs clear crits once the hull is whole (same bench, same hours).
  while (r.crits.length > 0 && op.stockpile.repair >= CRIT_REPAIR_COST && r.structure >= t.structure) {
    r.crits.pop();
    op.stockpile = { ...op.stockpile, repair: op.stockpile.repair - CRIT_REPAIR_COST };
  }
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
  if (op.stockpile.credits < def.prices.mech) return { ok: false, reason: "not enough credits" };
  const sign = CALL_SIGNS.find((c) => !op.usedCallSigns.includes(c));
  if (!sign) return { ok: false, reason: "no call signs left" };
  const living = op.roster.filter((r) => r.alive && unitType(r.typeId).cls === "mech");
  const assaults = living.filter((r) => r.typeId === "mech_assault").length;
  const scouts = living.filter((r) => r.typeId === "mech_scout").length;
  const typeId = assaults <= scouts ? "mech_assault" : "mech_scout"; // fill the gap
  op.roster.push(fullRecord(typeId, sign));
  op.usedCallSigns.push(sign);
  op.stockpile = { ...op.stockpile, credits: op.stockpile.credits - def.prices.mech };
  return { ok: true, callSign: sign };
}

/** Replace a DESTROYED support vehicle of the same type (fresh crew, full state). */
export function requisitionSupport(op: OperationState, rosterIndex: number): { ok: boolean; reason?: string } {
  const def = operationDef(op);
  const r = op.roster[rosterIndex];
  if (!r || r.alive) return { ok: false, reason: "nothing to replace" };
  if (unitType(r.typeId).cls === "mech") return { ok: false, reason: "mech losses are permanent" };
  const price = def.prices.support[unitType(r.typeId).cls] ?? 999;
  if (op.stockpile.credits < price) return { ok: false, reason: "not enough credits" };
  Object.assign(r, fullRecord(r.typeId));
  op.stockpile = { ...op.stockpile, credits: op.stockpile.credits - price };
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

    while (m.crits.length > 0 && op.stockpile.repair >= CRIT_REPAIR_COST) {
      const crit = m.crits.pop()!;
      op.stockpile = { ...op.stockpile, repair: op.stockpile.repair - CRIT_REPAIR_COST };
      lines.push(`${crit} system restored`);
    }
    if (m.crits.length > 0) lines.push(`REQUEST: repair for ${m.crits.join(", ")}`);

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

    report.push(`${name}: ${lines.length ? lines.join(" · ") : "combat ready"}`);
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

/** Build the next battle's GameState with the roster's carried state injected.
 *  Dead units leave EMPTY SLOTS; a requisitioned replacement takes a vacant
 *  mech slot (same ID for determinism, its own name and chassis). */
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
  const state = createGame({ ...map, offmap }, op.seed * 31 + op.battleIndex + 1);

  // Match state's blue units (placement order) to living roster records:
  // same-type first, then replacements (different chassis) into vacant slots.
  const blue = state.units.filter((u) => u.side === "blue");
  const unmatchedUnits: UnitInstance[] = [];
  const used = new Set<number>();
  const matchOf = new Map<number, number>(); // unit id → roster index
  for (const u of blue) {
    const idx = op.roster.findIndex((r, i) => !used.has(i) && r.alive && r.typeId === u.typeId);
    if (idx >= 0) {
      used.add(idx);
      matchOf.set(u.id, idx);
    } else unmatchedUnits.push(u);
  }
  const spareMechs = op.roster
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => !used.has(i) && r.alive && unitType(r.typeId).cls === "mech");
  for (const u of unmatchedUnits.slice()) {
    if (unitType(u.typeId).cls !== "mech" || spareMechs.length === 0) continue;
    const { r, i } = spareMechs.shift()!;
    used.add(i);
    // A replacement chassis takes the vacant slot: same id/hex/facing, new type.
    const t = unitType(r.typeId);
    u.typeId = r.typeId;
    u.structure = t.structure;
    u.ammo = t.weapons.map((w) => w.ammoMax);
    u.fuel = t.fuelMax;
    matchOf.set(u.id, i);
    unmatchedUnits.splice(unmatchedUnits.indexOf(u), 1);
  }
  // Vacant slots with nobody to fill them: the dead stay dead.
  state.units = state.units.filter((u) => u.side !== "blue" || !unmatchedUnits.includes(u));

  // Carry the records onto the survivors.
  for (const u of state.units) {
    const idx = matchOf.get(u.id);
    if (idx === undefined) continue;
    const r = op.roster[idx];
    u.structure = r.structure;
    u.ammo = [...r.ammo];
    u.fuel = r.fuel;
    u.crits = [...r.crits];
    if (r.callSign) u.callSign = r.callSign;
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
    r.crits = [...u.crits];
    if (!r.alive && r.callSign) mechsLost.push(r.callSign);
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
  op.history.push({ title: battle.title, won, turns: state.turn, mechsLost });

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

// The roster link travels on the unit so recording survives serialization-free.
declare module "./state" {
  interface UnitInstance {
    userRosterIndex?: number;
  }
}

/** Placement helper kept for tests: blue slots of a map in placement order. */
export function blueSlots(mapId: string): UnitPlacement[] {
  return mapById(mapId).units.filter((p) => p.side === "blue");
}
