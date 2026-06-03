import { describe, it, expect } from "vitest";
import { World, KIND_ENEMY, KIND_GEM, KIND_PROJECTILE } from "../src/sim/world";
import { SpatialHash } from "../src/sim/spatialHash";
import { Sim, type InputState } from "../src/sim/sim";

const STILL: InputState = { x: 0, z: 0 };

/** Advance the sim for `seconds` at the fixed step with a constant input. */
function run(sim: Sim, seconds: number, input: InputState = STILL): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) sim.update(dt, input);
}

describe("ECS world (SoA + free list)", () => {
  it("recycles freed slots and tracks alive count", () => {
    const w = new World(4);
    const a = w.spawn();
    const b = w.spawn();
    expect(w.aliveCount).toBe(2);
    w.free(a);
    expect(w.aliveCount).toBe(1);
    const c = w.spawn();
    expect(c).toBe(a); // recycled
    expect(w.aliveCount).toBe(2);
    expect(b).not.toBe(c);
  });

  it("returns -1 when the pool is exhausted", () => {
    const w = new World(2);
    w.spawn();
    w.spawn();
    expect(w.spawn()).toBe(-1);
  });
});

describe("spatial hash", () => {
  it("finds neighbors within the 3x3 cell block and skips far ones", () => {
    const h = new SpatialHash(2);
    h.insert(1, 0.1, 0.1);
    h.insert(2, 1.5, -0.5); // adjacent cell
    h.insert(3, 50, 50); // far away
    const found: number[] = [];
    h.forEachNear(0, 0, (id) => found.push(id));
    expect(found.sort()).toEqual([1, 2]);
  });
});

describe("M1 horde loop (features actually fire)", () => {
  it("the spawn director produces a growing swarm", () => {
    const sim = new Sim(7);
    run(sim, 5);
    expect(sim.world.countOf(KIND_ENEMY)).toBeGreaterThan(5);
  });

  it("the auto-weapon spawns projectiles when enemies are in range", () => {
    const sim = new Sim(7);
    // Let enemies approach, then check projectiles exist at least once.
    let sawProjectile = false;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 8; i++) {
      sim.update(dt, STILL);
      if (sim.world.countOf(KIND_PROJECTILE) > 0) sawProjectile = true;
    }
    expect(sawProjectile).toBe(true);
  });

  it("kills accumulate and each kill drops an XP gem", () => {
    const sim = new Sim(7);
    run(sim, 12);
    expect(sim.kills).toBeGreaterThan(0);
    // Gems are dropped on kill (some may already be collected, so check totals).
    expect(sim.kills).toBeGreaterThanOrEqual(sim.world.countOf(KIND_GEM));
  });

  it("collecting gems grants XP and levels the player up", () => {
    const sim = new Sim(7);
    run(sim, 20); // standing still: enemies pile on, die, gems get magneted in
    expect(sim.kills).toBeGreaterThan(0);
    expect(sim.level).toBeGreaterThan(1);
  });

  it("standing in the swarm costs the player HP", () => {
    const sim = new Sim(7);
    run(sim, 20);
    expect(sim.playerHp).toBeLessThan(100);
  });

  it("is deterministic for a given seed", () => {
    const a = new Sim(42);
    const b = new Sim(42);
    run(a, 6);
    run(b, 6);
    expect(a.kills).toBe(b.kills);
    expect(a.world.countOf(KIND_ENEMY)).toBe(b.world.countOf(KIND_ENEMY));
    expect(a.playerHp).toBeCloseTo(b.playerHp, 6);
  });
});
