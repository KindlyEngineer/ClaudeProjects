import { describe, it, expect } from "vitest";
import { Terrain } from "../src/sim/terrain";
import { highGroundMultiplier } from "../src/sim/combat";
import { Sim } from "../src/sim/sim";
import { KIND_GEM } from "../src/sim/world";
import { defaultRunConfig, HIGHLANDS } from "../src/config/runConfig";
import {
  ARENA_RADIUS,
  HIGH_GROUND_MAX,
  HIGH_GROUND_MIN,
  PIT_LEVEL,
} from "../src/config/balance";
import { normalize2 } from "../src/core/math";

function makeTerrain(seed = 7): Terrain {
  return new Terrain(seed, HIGHLANDS.terrain, ARENA_RADIUS);
}

/** Scan the arena for a point inside a lethal pit (deterministic per seed). */
function findPit(t: Terrain): { x: number; z: number } | null {
  for (let x = -ARENA_RADIUS; x <= ARENA_RADIUS; x += 1) {
    for (let z = -ARENA_RADIUS; z <= ARENA_RADIUS; z += 1) {
      if (t.isPit(x, z)) return { x, z };
    }
  }
  return null;
}

describe("terrain heightmap", () => {
  it("is deterministic for a seed and varies by seed", () => {
    const a = makeTerrain(7);
    const b = makeTerrain(7);
    const c = makeTerrain(8);
    expect(a.heightAt(3, 4)).toBe(b.heightAt(3, 4));
    expect(a.heightAt(3, 4)).not.toBe(c.heightAt(3, 4));
  });

  it("has a raised central plateau (high ground)", () => {
    const t = makeTerrain(7);
    const center = t.heightAt(0, 0);
    // Center should out-rise the average of a far ring.
    let ringSum = 0;
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      ringSum += t.heightAt(Math.cos(a) * 40, Math.sin(a) * 40);
    }
    expect(center).toBeGreaterThan(ringSum / N);
  });

  it("carves at least one lethal pit below PIT_LEVEL", () => {
    const t = makeTerrain(7);
    const pit = findPit(t);
    expect(pit).not.toBeNull();
    if (pit) expect(t.heightAt(pit.x, pit.z)).toBeLessThanOrEqual(PIT_LEVEL);
  });
});

describe("high-ground combat rule", () => {
  it("is neutral at equal height", () => {
    expect(highGroundMultiplier(5, 5)).toBeCloseTo(1, 6);
  });
  it("rewards shooting downhill and penalizes uphill", () => {
    expect(highGroundMultiplier(10, 4)).toBeGreaterThan(1);
    expect(highGroundMultiplier(4, 10)).toBeLessThan(1);
  });
  it("clamps to the configured bounds", () => {
    expect(highGroundMultiplier(1000, 0)).toBe(HIGH_GROUND_MAX);
    expect(highGroundMultiplier(0, 1000)).toBe(HIGH_GROUND_MIN);
  });
});

describe("terrain-aware sim mechanics", () => {
  it("moves the player faster downhill than uphill", () => {
    // Find a point with a meaningful slope.
    const probe = new Sim(defaultRunConfig(7));
    let best = { x: 8, z: 0, mag: 0 };
    for (let x = -30; x <= 30; x += 3) {
      for (let z = -30; z <= 30; z += 3) {
        if (probe.terrain.isPit(x, z)) continue;
        const g = probe.terrain.gradient(x, z);
        const mag = Math.hypot(g.gx, g.gz);
        if (mag > best.mag) best = { x, z, mag };
      }
    }
    const g = probe.terrain.gradient(best.x, best.z);
    const [ux, uz] = normalize2(g.gx, g.gz); // uphill heading

    const travel = (dx: number, dz: number): number => {
      const s = new Sim(defaultRunConfig(7));
      s.playerX = best.x;
      s.playerZ = best.z;
      s.update(1 / 60, { x: dx, z: dz });
      return Math.hypot(s.playerX - best.x, s.playerZ - best.z);
    };

    const downhill = travel(-ux, -uz);
    const uphill = travel(ux, uz);
    expect(downhill).toBeGreaterThan(uphill);
  });

  it("rolls XP gems downhill", () => {
    const sim = new Sim(defaultRunConfig(7));
    // Park the player far away so the gem rolls instead of being magneted.
    sim.playerX = 999;
    sim.playerZ = 999;
    const w = sim.world;
    const id = w.spawn();
    const sx = 22;
    const sz = 6;
    w.kind[id] = KIND_GEM;
    w.px[id] = sx;
    w.pz[id] = sz;
    w.vx[id] = 0;
    w.vz[id] = 0;
    w.amount[id] = 1;
    const g = sim.terrain.gradient(sx, sz);
    for (let i = 0; i < 10; i++) sim.update(1 / 60, { x: 0, z: 0 });
    // Displacement should point downhill (opposite the uphill gradient).
    const dxp = w.px[id] - sx;
    const dzp = w.pz[id] - sz;
    expect(dxp * -g.gx + dzp * -g.gz).toBeGreaterThan(0);
  });

  it("kills the player who stands in a pit", () => {
    const sim = new Sim(defaultRunConfig(7));
    const pit = findPit(sim.terrain);
    expect(pit).not.toBeNull();
    if (pit) {
      sim.playerX = pit.x;
      sim.playerZ = pit.z;
      sim.update(1 / 60, { x: 0, z: 0 });
      expect(sim.playerHp).toBe(0);
    }
  });
});
