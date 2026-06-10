import { describe, it, expect } from "vitest";
import {
  assignSorties,
  commanderRefit,
  createOperation,
  finishInterlude,
  prepareBattle,
  recordBattle,
  requisitionMech,
  requisitionSupport,
  spendOnSupport,
  type OperationState,
} from "../src/sim/operation";
import { unitType } from "../src/data/units";
import { unitLabel } from "../src/sim/state";

// The operation layer: full carry-over (ruling D1), the Interlude's provision-
// never-task split, permanent mech death + differentiated requisitions, and
// failure-forward defeat. All pure and JSON-serializable (the checkpoint save).

const fresh = (): OperationState => createOperation("op01", 7);

describe("operation lifecycle", () => {
  it("starts at the staging Interlude with a full named roster", () => {
    const op = fresh();
    expect(op.phase).toBe("interlude");
    expect(op.battleIndex).toBe(0);
    const mechs = op.roster.filter((r) => unitType(r.typeId).cls === "mech");
    expect(mechs.length).toBeGreaterThan(0);
    expect(mechs.every((m) => m.callSign)).toBe(true);
  });

  it("carries battle damage forward and the dead stay dead", () => {
    const op = fresh();
    finishInterlude(op);
    const state = prepareBattle(op);
    const mech = state.units.find((u) => u.side === "blue" && unitType(u.typeId).cls === "mech")!;
    const truck = state.units.find((u) => u.side === "blue" && u.typeId === "supply")!;
    mech.structure = 9; // mauled
    mech.crits.push("sensors");
    truck.structure = 0; // lost
    state.outcome = "blue";
    state.turn = 9;
    recordBattle(op, state);

    expect(op.phase).toBe("interlude");
    expect(op.battleIndex).toBe(1);
    const mechRec = op.roster.find((r) => r.callSign === mech.callSign)!;
    expect(mechRec.structure).toBe(9); // FULL carry-over
    expect(mechRec.crits).toContain("sensors");
    expect(op.roster.find((r) => r.typeId === "supply")!.alive).toBe(false);

    // Without a replacement, the truck's slot is EMPTY next battle; with a
    // STARVED depot, the mech marches mauled (the refit had nothing to give).
    op.stockpile = { ...op.stockpile, repair: 0, ammo: 0, fuel: 0 };
    finishInterlude(op);
    expect(op.refitReport.some((l) => l.includes("REQUEST"))).toBe(true); // it asked
    const next = prepareBattle(op);
    expect(next.units.some((u) => u.side === "blue" && u.typeId === "supply")).toBe(false);
    const carried = next.units.find((u) => u.callSign === mech.callSign)!;
    expect(carried.structure).toBe(9); // the depot was empty — it fights hurt
  });

  it("the commander refits its mechs from the depot, legibly, and reports shortfalls", () => {
    const op = fresh();
    const mech = op.roster.find((r) => unitType(r.typeId).cls === "mech")!;
    mech.structure = 5;
    mech.crits = ["mobility"];
    mech.ammo = mech.ammo.map(() => 0);
    op.stockpile = { ...op.stockpile, repair: 10, ammo: 4 }; // a starved depot
    const report = commanderRefit(op);
    expect(mech.structure).toBe(15); // took all 10 repair
    expect(mech.crits).toContain("mobility"); // no points left to clear it
    const line = report.find((l) => l.startsWith(mech.callSign!))!;
    expect(line).toContain("hull +10");
    expect(line).toContain("REQUEST"); // it says what it still needs
  });

  it("the player provisions only their OWN echelon — mechs are refused", () => {
    const op = fresh();
    const mechIdx = op.roster.findIndex((r) => unitType(r.typeId).cls === "mech");
    expect(spendOnSupport(op, mechIdx, { repair: 5 }).reason).toBe("the commander manages its mechs");

    const truckIdx = op.roster.findIndex((r) => r.typeId === "supply");
    op.roster[truckIdx].fuel = 0;
    const fuel0 = op.stockpile.fuel;
    expect(spendOnSupport(op, truckIdx, { fuel: 20 }).ok).toBe(true);
    expect(op.roster[truckIdx].fuel).toBe(20);
    expect(op.stockpile.fuel).toBe(fuel0 - 20);
  });

  it("mech death is permanent; a requisition fields a NEW name and chassis", () => {
    const op = fresh();
    const mech = op.roster.find((r) => unitType(r.typeId).cls === "mech")!;
    mech.alive = false; // Vanguard is gone
    const deadSign = mech.callSign!;
    op.stockpile = { ...op.stockpile, credits: 200 };

    const r = requisitionMech(op);
    expect(r.ok).toBe(true);
    expect(r.callSign).not.toBe(deadSign); // a name is never reissued
    expect(op.stockpile.credits).toBe(50);
    const recruit = op.roster.find((x) => x.callSign === r.callSign)!;
    expect(recruit.alive).toBe(true);

    // The recruit takes the vacant mech slot next battle, name and all.
    finishInterlude(op);
    const state = prepareBattle(op);
    const fielded = state.units.filter((u) => u.side === "blue" && unitType(u.typeId).cls === "mech");
    expect(fielded.some((u) => unitLabel(u) === r.callSign)).toBe(true);
    expect(fielded.some((u) => unitLabel(u) === deadSign)).toBe(false);
  });

  it("dead support is replaceable at cost; sorties assign into the next battle", () => {
    const op = fresh();
    const truckIdx = op.roster.findIndex((r) => r.typeId === "supply");
    op.roster[truckIdx].alive = false;
    expect(requisitionSupport(op, truckIdx).ok).toBe(true);
    expect(op.roster[truckIdx].alive).toBe(true);

    expect(assignSorties(op, 1, 2).ok).toBe(true);
    expect(op.stockpile.strikes).toBe(0);
    finishInterlude(op);
    const state = prepareBattle(op);
    expect(state.offmap.blue.strike).toBe(1);
    expect(state.offmap.blue.recon).toBe(2);
    expect(op.nextOffmap).toEqual({ strike: 0, recon: 0 }); // flown or forfeited
  });

  it("failure-forward: a non-final loss continues; losing every mech fails it", () => {
    const op = fresh();
    finishInterlude(op);
    const b1 = prepareBattle(op);
    b1.outcome = "red"; // battle one is LOST
    b1.turn = 14;
    recordBattle(op, b1);
    expect(op.outcome).toBe("ongoing"); // carried, not retried
    expect(op.battleIndex).toBe(1);

    for (const u of op.roster) if (unitType(u.typeId).cls === "mech") u.alive = false;
    finishInterlude(op);
    const b2 = prepareBattle(op);
    b2.outcome = "red";
    recordBattle(op, b2);
    expect(op.outcome).toBe("failed"); // no main effort left to enable
  });

  it("round-trips through JSON (the checkpoint save)", () => {
    const op = fresh();
    finishInterlude(op);
    const state = prepareBattle(op);
    state.outcome = "blue";
    recordBattle(op, state);
    const back = JSON.parse(JSON.stringify(op)) as OperationState;
    expect(back).toEqual(op);
    finishInterlude(back); // and keeps working after the reload
    expect(prepareBattle(back).units.length).toBeGreaterThan(0);
  });
});
