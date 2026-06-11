import { describe, it, expect } from "vitest";
import { generatedOperation, genMapId, mapById, resolveOperationDef } from "../src/data/operations";
import { buySupport, createOperation, finishInterlude, operationDef, prepareBattle, recordBattle, type OperationState } from "../src/sim/operation";
import { confirmDeployment } from "../src/sim/actions";
import { noSupport, runMatch } from "../src/sim/match";
import { unitType } from "../src/data/units";

// Horizon 2 — GENERATED OPERATIONS: a seeded campaign on the map generator.
// The (defId, seed) pair is ALL a checkpoint save stores — the identical
// campaign regenerates from it, maps and economy alike. Trust, the persistent
// enemy and service records hang off OperationState, so they work unchanged.

describe("generated operations", () => {
  it("are deterministic per seed — and different across seeds", () => {
    const a1 = generatedOperation(42);
    const a2 = generatedOperation(42);
    expect(a2).toBe(a1); // memoized — one campaign per seed
    expect(mapById(genMapId(42, 0))).toBe(mapById(genMapId(42, 0)));
    const b = generatedOperation(43);
    expect(b.name).not.toBe(a1.name);
    expect(mapById(b.battles[0].mapId).cells).not.toEqual(mapById(a1.battles[0].mapId).cells);
  });

  it("escalate: the finale fields heavier metal than the opening", () => {
    const def = generatedOperation(7);
    const types = (i: number) => mapById(def.battles[i].mapId).units.filter((p) => p.side === "red").map((p) => p.type);
    expect(types(0)).not.toContain("heavy_tank");
    expect(types(2)).toContain("heavy_tank"); // the breaking point earns its name
  });

  it("run the full campaign machinery: roster, deployment, enemy pool, completion", () => {
    const op = createOperation("genop", 42);
    expect(operationDef(op).name).toContain("42");
    const mechs = op.roster.filter((r) => unitType(r.typeId).cls === "mech");
    expect(mechs.length).toBe(2); // standard preset fixes the roster
    expect(mechs.every((m) => m.callSign)).toBe(true);
    expect(op.enemy.length).toBeGreaterThan(0); // the persistent formation derived

    buySupport(op, "supply");
    buySupport(op, "recon");
    for (let i = 0; i < 3; i++) {
      finishInterlude(op);
      const state = prepareBattle(op);
      expect(state.deployPending).toBe(true);
      expect(state.units.some((u) => u.side === "red")).toBe(true);
      confirmDeployment(state);
      state.outcome = "blue";
      state.turn = 9;
      recordBattle(op, state);
    }
    expect(op.outcome).toBe("complete");
  });

  it("a generated battle is SOUND under full-AI headless play", () => {
    const op = createOperation("genop", 11);
    finishInterlude(op);
    const state = prepareBattle(op);
    confirmDeployment(state);
    const r = runMatch(state, noSupport);
    expect(["blue", "red"]).toContain(r.outcome); // terminates decisively
  });

  it("regenerates identically from a checkpoint save (defId + seed is enough)", () => {
    const op = createOperation("genop", 42);
    buySupport(op, "supply");
    finishInterlude(op);
    const b1 = prepareBattle(op);
    b1.outcome = "blue";
    recordBattle(op, b1);

    const back = JSON.parse(JSON.stringify(op)) as OperationState;
    expect(resolveOperationDef(back.defId, back.seed).name).toBe(operationDef(op).name);
    finishInterlude(back);
    const next = prepareBattle(back);
    expect(next.units.length).toBeGreaterThan(0);
    expect(next.map.cells).toEqual(prepareBattle(op).map.cells); // the same ground
  });
});
