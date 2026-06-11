import { describe, it, expect } from "vitest";
import { buySupport, createOperation, finishInterlude, prepareBattle, recordBattle, type OperationState } from "../src/sim/operation";
import { mapById, OPERATIONS } from "../src/data/operations";
import { unitType } from "../src/data/units";

// Horizon 2 — the PERSISTENT ENEMY: the opposing formation carries its losses
// across the operation. Kill a tank in battle one and it is not waiting in
// battle three; attrition becomes operational work and confirmed kills become
// operational intel. Survivors refit between battles — full resupply, half
// the hull damage, broken components stay broken.

const redOf = (state: ReturnType<typeof prepareBattle>) => state.units.filter((u) => u.side === "red");

describe("the enemy formation", () => {
  it("is sized so every battle opens fully manned (per-type max across the operation)", () => {
    const op = createOperation("op01", 3);
    for (const b of OPERATIONS.op01.battles) {
      const need = new Map<string, number>();
      for (const p of mapById(b.mapId).units) if (p.side === "red") need.set(p.type, (need.get(p.type) ?? 0) + 1);
      for (const [t, n] of need) {
        expect(op.enemy.filter((r) => r.typeId === t).length).toBeGreaterThanOrEqual(n);
      }
    }
  });

  it("battle damage carries: the dead leave empty slots, the wounded return patched", () => {
    const op = createOperation("op01", 3);
    buySupport(op, "supply");
    finishInterlude(op);
    const b1 = prepareBattle(op);
    const red1 = redOf(b1);
    const dead = red1[0];
    const wounded = red1.find((u) => u.id !== dead.id && unitType(u.typeId).structure >= 8)!;
    const deadType = dead.typeId;
    const woundedMax = unitType(wounded.typeId).structure;

    dead.structure = 0; // killed outright
    wounded.structure = 2; // mauled
    wounded.componentsLost.push(unitType(wounded.typeId).components[0].id); // something broke
    b1.outcome = "blue";
    b1.turn = 9;
    const aliveBefore = op.enemy.filter((r) => r.alive).length;
    recordBattle(op, b1);

    expect(op.enemy.filter((r) => r.alive).length).toBe(aliveBefore - 1); // the dead stay dead
    expect(op.history[0].enemyDestroyed).toContain(unitType(deadType).name); // confirmed intel

    finishInterlude(op);
    const b2 = prepareBattle(op);
    const red2 = redOf(b2);
    // The patched survivor: half the missing hull back, the component still broken.
    const patched = red2.find((u) => u.componentsLost.length > 0)!;
    expect(patched.structure).toBe(2 + Math.ceil((woundedMax - 2) / 2));
    expect(patched.structure).toBeLessThan(woundedMax);
    expect(patched.crits.length).toBeGreaterThan(0); // the derived state travels with it
  });

  it("annihilating a type empties its slots in later battles", () => {
    const op = createOperation("op01", 3);
    buySupport(op, "supply");
    // Kill every record of the most numerous red type by hand (the ledger is data).
    const tally = new Map<string, number>();
    for (const r of op.enemy) tally.set(r.typeId, (tally.get(r.typeId) ?? 0) + 1);
    const [most] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    for (const r of op.enemy) if (r.typeId === most) r.alive = false;

    finishInterlude(op);
    const state = prepareBattle(op);
    expect(redOf(state).some((u) => u.typeId === most)).toBe(false); // nobody left to man them
    expect(redOf(state).length).toBeGreaterThan(0); // the rest of the formation still fights
  });

  it("rides the checkpoint save like everything else", () => {
    const op = createOperation("op01", 3);
    buySupport(op, "supply");
    finishInterlude(op);
    const b1 = prepareBattle(op);
    redOf(b1)[0].structure = 0;
    b1.outcome = "blue";
    recordBattle(op, b1);
    const back = JSON.parse(JSON.stringify(op)) as OperationState;
    expect(back.enemy).toEqual(op.enemy);
    finishInterlude(back);
    expect(redOf(prepareBattle(back)).length).toBe(redOf(prepareBattle(op)).length);
  });
});
