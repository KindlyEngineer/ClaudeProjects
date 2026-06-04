import { describe, it, expect } from "vitest";
import { Sim, type InputState } from "../src/sim/sim";
import { defaultRunConfig } from "../src/config/runConfig";
import { BOSS_INTERVAL_SEC, DRAFT_OPTIONS } from "../src/config/balance";
import { KIND_ENEMY, KIND_PROJECTILE, VARIANT_BOSS, VARIANT_GRUNT } from "../src/sim/world";
import { mulberry32 } from "../src/core/rng";
import {
  gunStats,
  lanceStats,
  lobStats,
  orbitStats,
  W_GUN,
  W_KNOCKER,
  W_LOB,
  W_ORBIT,
  type WeaponId,
} from "../src/sim/weapons";
import { rollUpgrades, type DraftState } from "../src/sim/upgrades";

const STILL: InputState = { x: 0, z: 0 };

function run(sim: Sim, seconds: number, input: InputState = STILL): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) sim.update(dt, input);
}

/** Plant a single enemy directly into the world (bypassing the spawn director). */
function plantEnemy(sim: Sim, x: number, z: number, hp: number, variant = VARIANT_GRUNT): number {
  const w = sim.world;
  const id = w.spawn();
  w.kind[id] = KIND_ENEMY;
  w.variant[id] = variant;
  w.px[id] = x;
  w.pz[id] = z;
  w.hp[id] = hp;
  w.maxhp[id] = hp;
  w.radius[id] = 0.6;
  return id;
}

describe("weapon stat scaling (pure)", () => {
  const M = { dmgMul: 1, fireRateMul: 1 };

  it("levels raise damage and shorten cooldown", () => {
    expect(gunStats(2, M).damage).toBeGreaterThan(gunStats(1, M).damage);
    expect(gunStats(2, M).cooldown).toBeLessThan(gunStats(1, M).cooldown);
  });

  it("the lance pierces more enemies per level", () => {
    expect(lanceStats(1, M).pierce).toBe(2);
    expect(lanceStats(3, M).pierce).toBe(4);
  });

  it("only the lobber ignores line of sight", () => {
    expect(lobStats(1, M).ignoresLineOfSight).toBe(true);
    expect(gunStats(1, M).ignoresLineOfSight).toBe(false);
  });

  it("orbit blade count grows on alternating levels", () => {
    expect(orbitStats(1, M).count).toBe(2);
    expect(orbitStats(2, M).count).toBe(3);
  });

  it("passive mods scale damage and fire rate", () => {
    const fast = gunStats(1, { dmgMul: 2, fireRateMul: 2 });
    const base = gunStats(1, M);
    expect(fast.damage).toBeCloseTo(base.damage * 2, 6);
    expect(fast.cooldown).toBeCloseTo(base.cooldown / 2, 6);
  });
});

describe("upgrade draft rolling (pure + deterministic)", () => {
  const fresh: DraftState = { weapons: new Map([[W_GUN, 1]]), passives: new Map() };

  it("offers distinct options and is deterministic per seed", () => {
    const a = rollUpgrades(fresh, mulberry32(3), DRAFT_OPTIONS);
    const b = rollUpgrades(fresh, mulberry32(3), DRAFT_OPTIONS);
    expect(a).toEqual(b);
    expect(a.length).toBe(DRAFT_OPTIONS);
    const labels = a.map((u) => u.name);
    expect(new Set(labels).size).toBe(labels.length); // all distinct
  });

  it("returns nothing once every weapon and passive is maxed", () => {
    const maxed: DraftState = {
      weapons: new Map([
        [W_GUN, 6],
        [1, 6],
        [W_LOB, 6],
        [W_ORBIT, 6],
        [W_KNOCKER, 6],
      ]),
      passives: new Map([
        ["damage", 5],
        ["firerate", 5],
        ["speed", 5],
        ["maxhp", 5],
        ["magnet", 5],
      ]),
    };
    expect(rollUpgrades(maxed, mulberry32(1), DRAFT_OPTIONS)).toEqual([]);
  });
});

describe("the build loop (level-up draft in the running sim)", () => {
  it("auto-draft grows the build over a run", () => {
    const sim = new Sim(defaultRunConfig(7)); // autoDraft defaults on
    run(sim, 25);
    expect(sim.playerLevel).toBeGreaterThan(1);
    expect(sim.loadout.size + sim.passives.size).toBeGreaterThan(1);
    expect(sim.draftPending()).toBe(false); // auto-resolved, nothing queued
  });

  it("pauses for a manual choice when auto-draft is off", () => {
    const sim = new Sim(defaultRunConfig(7));
    sim.autoDraft = false;
    run(sim, 25);
    expect(sim.draftPending()).toBe(true);
    const before = sim.loadout.size + sim.passives.size;
    sim.chooseUpgrade(0);
    expect(sim.loadout.size + sim.passives.size).toBeGreaterThanOrEqual(before);
  });
});

describe("geometry-exploiting weapon archetypes", () => {
  it("the lobber fires at an enemy with no line of sight; the gun does not", () => {
    // Build a wall barrier between the player and a planted target.
    const setup = (weapon: WeaponId) => {
      const sim = new Sim(defaultRunConfig(1));
      sim.autoDraft = false;
      const lvl = sim.level;
      const cx = lvl.cellX(0);
      const cz = lvl.cellZ(0);
      sim.playerX = lvl.worldX(cx);
      sim.playerZ = lvl.worldZ(cz);
      for (let d = -3; d <= 3; d++) lvl.setCell(cx + 2, cz + d, 1); // TILE_WALL barrier
      const tx = lvl.worldX(cx + 4);
      const tz = lvl.worldZ(cz);
      sim.loadout.clear();
      sim.loadout.set(weapon, 1);
      plantEnemy(sim, tx, tz, 50);
      expect(lvl.hasLineOfSight(sim.playerX, sim.playerZ, tx, tz)).toBe(false);
      return sim;
    };

    // Lobber: arcs over the wall → fires on the first tick.
    const lob = setup(W_LOB);
    lob.update(1 / 60, STILL);
    expect(lob.world.countOf(KIND_PROJECTILE)).toBeGreaterThan(0);

    // Gun: LOS-gated, target hidden, spawned grunts out of range → never fires.
    const gun = setup(W_GUN);
    let fired = false;
    for (let i = 0; i < 30; i++) {
      gun.update(1 / 60, STILL);
      if (gun.world.countOf(KIND_PROJECTILE) > 0) fired = true;
    }
    expect(fired).toBe(false);
  });

  it("orbit blades damage an adjacent enemy with no projectile or LOS", () => {
    const sim = new Sim(defaultRunConfig(1));
    sim.autoDraft = false;
    sim.loadout.clear();
    sim.pendingDrafts.push([{ type: "new-weapon", weapon: W_ORBIT, name: "", blurb: "" }]);
    sim.chooseUpgrade(0); // spawns the orbiter entities (a blade sits at +x)
    const id = plantEnemy(sim, sim.playerX + 3.3, sim.playerZ, 50); // on the orbit ring
    run(sim, 3);
    expect(sim.world.hp[id]).toBeLessThan(50); // damaged by a passing blade
    expect(sim.world.countOf(KIND_PROJECTILE)).toBe(0); // orbit fires no projectiles
  });

  it("the knocker imparts heavy knockback", () => {
    const sim = new Sim(defaultRunConfig(1));
    sim.autoDraft = false;
    sim.loadout.clear();
    sim.loadout.set(W_KNOCKER, 1);
    const id = plantEnemy(sim, sim.playerX + 6, sim.playerZ, 400); // survives the low damage
    let maxKb = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 90; i++) {
      sim.update(dt, STILL);
      maxKb = Math.max(maxKb, Math.hypot(sim.world.kx[id], sim.world.kz[id]));
    }
    expect(maxKb).toBeGreaterThan(15);
  });
});

describe("difficulty curve + boss", () => {
  it("spawns a boss at the interval, big and tough", () => {
    const sim = new Sim(defaultRunConfig(3));
    sim.time = BOSS_INTERVAL_SEC - 0.01;
    sim.update(0.02, STILL);
    const w = sim.world;
    let boss = -1;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] === 1 && w.kind[i] === KIND_ENEMY && w.variant[i] === VARIANT_BOSS) boss = i;
    }
    expect(boss).toBeGreaterThanOrEqual(0);
    expect(w.radius[boss]).toBeGreaterThan(1);
    expect(w.hp[boss]).toBeGreaterThan(100);
    expect(sim.bossHealthFraction()).toBeGreaterThan(0);
  });

  it("enemy HP scales up over time", () => {
    const early = new Sim(defaultRunConfig(3));
    early.update(1 / 60, STILL);
    const late = new Sim(defaultRunConfig(3));
    late.time = 200;
    late.update(1 / 60, STILL);
    const firstHp = (sim: Sim) => {
      const w = sim.world;
      for (let i = 0; i < w.cap; i++) {
        if (w.alive[i] === 1 && w.kind[i] === KIND_ENEMY && w.variant[i] === VARIANT_GRUNT)
          return w.maxhp[i];
      }
      return 0;
    };
    expect(firstHp(late)).toBeGreaterThan(firstHp(early));
  });
});

describe("determinism with the full build loop", () => {
  it("two same-seed runs match on kills and resulting loadout", () => {
    const a = new Sim(defaultRunConfig(5));
    const b = new Sim(defaultRunConfig(5));
    run(a, 20);
    run(b, 20);
    expect(a.kills).toBe(b.kills);
    expect(a.playerLevel).toBe(b.playerLevel);
    expect(a.weaponSummary()).toEqual(b.weaponSummary());
    expect(a.passiveSummary()).toEqual(b.passiveSummary());
  });
});
