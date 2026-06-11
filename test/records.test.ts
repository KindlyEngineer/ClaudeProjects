import { describe, it, expect } from "vitest";
import { buySupport, createOperation, finishInterlude, prepareBattle, recordBattle, type OperationState } from "../src/sim/operation";
import { emit } from "../src/sim/events";

// Horizon 2 — SERVICE RECORDS: what each name did, written from the event
// stream battle by battle. The fallen keep theirs; the wall reads them out.

const staged = () => {
  const op = createOperation("op01", 9);
  buySupport(op, "supply");
  finishInterlude(op);
  return { op, state: prepareBattle(op) };
};

describe("service records", () => {
  it("accumulate battles, kills and resupplies from the event stream", () => {
    const { op, state } = staged();
    const mech = state.units.find((u) => u.callSign && u.side === "blue")!;
    const truck = state.units.find((u) => u.typeId === "supply" && u.side === "blue")!;
    const enemy = state.units.find((u) => u.side === "red")!;

    emit(state, { kind: "fire", id: mech.id, side: "blue", targetId: enemy.id, weapon: "AC", from: mech.hex, at: enemy.hex, hit: true, penetrated: true, damage: 9, arc: "front", crit: null, suppression: 0, destroyed: true });
    emit(state, { kind: "fire", id: mech.id, side: "blue", targetId: enemy.id, weapon: "AC", from: mech.hex, at: enemy.hex, hit: true, penetrated: false, damage: 0, arc: "front", crit: null, suppression: 2, destroyed: false });
    emit(state, { kind: "resupply", id: truck.id, side: "blue", targetId: mech.id, ammo: 4, fuel: 0 });
    state.outcome = "blue";
    state.turn = 7;
    recordBattle(op, state);

    const rec = op.records[mech.callSign!];
    expect(rec.battles).toBe(1);
    expect(rec.kills).toBe(1); // only the destroying shot counts
    expect(rec.resupplied).toBe(1);
    expect(rec.fellAt).toBeUndefined();

    // A second battle adds to the same ledger.
    finishInterlude(op);
    const b2 = prepareBattle(op);
    b2.outcome = "red";
    recordBattle(op, b2);
    expect(op.records[mech.callSign!].battles).toBe(2);
  });

  it("the fallen keep their record, marked with where they ended", () => {
    const { op, state } = staged();
    const mech = state.units.find((u) => u.callSign && u.side === "blue")!;
    mech.structure = 0;
    state.outcome = "red";
    recordBattle(op, state);
    const rec = op.records[mech.callSign!];
    expect(rec.battles).toBe(1);
    expect(rec.fellAt).toContain("Battle I"); // permanence, named
  });

  it("round-trips through the checkpoint save", () => {
    const { op, state } = staged();
    state.outcome = "blue";
    recordBattle(op, state);
    const back = JSON.parse(JSON.stringify(op)) as OperationState;
    expect(back.records).toEqual(op.records);
  });
});
