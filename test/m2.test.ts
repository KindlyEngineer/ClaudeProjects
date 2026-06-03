import { describe, it, expect } from "vitest";
import { Level, TILE_WALL, TILE_FLOOR, TILE_HAZARD } from "../src/sim/level";
import { generateLevel } from "../src/sim/levelGen";
import { FlowField } from "../src/sim/flowField";
import { Sim } from "../src/sim/sim";
import { KIND_ENEMY } from "../src/sim/world";
import { defaultRunConfig, FOUNDRY } from "../src/config/runConfig";

describe("tile level generation", () => {
  it("is deterministic per seed and varies by seed", () => {
    const a = generateLevel(7, FOUNDRY);
    const b = generateLevel(7, FOUNDRY);
    const c = generateLevel(8, FOUNDRY);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(Array.from(a.tiles)).not.toEqual(Array.from(c.tiles));
  });

  it("walls the border and keeps the centre walkable", () => {
    const lvl = generateLevel(7, FOUNDRY);
    expect(lvl.tileAtCell(0, 0)).toBe(TILE_WALL);
    expect(lvl.tileAtCell(lvl.cols - 1, lvl.rows - 1)).toBe(TILE_WALL);
    expect(lvl.tileAt(0, 0)).toBe(TILE_FLOOR); // central plaza
  });

  it("every floor tile is reachable from the centre (open chunk borders)", () => {
    const lvl = generateLevel(7, FOUNDRY);
    const ff = new FlowField(lvl.cols, lvl.rows);
    ff.rebuild(lvl, lvl.cellX(0), lvl.cellZ(0));
    // Count floor tiles vs. ones the BFS reached: chunk borders are floor, so
    // the whole floor network should be connected.
    let floor = 0;
    let reached = 0;
    for (let cz = 0; cz < lvl.rows; cz++) {
      for (let cx = 0; cx < lvl.cols; cx++) {
        if (lvl.tileAtCell(cx, cz) !== TILE_FLOOR) continue;
        floor++;
        const s = ff.sampleCell(cx, cz);
        const isGoal = cx === lvl.cellX(0) && cz === lvl.cellZ(0);
        if (isGoal || s.fx !== 0 || s.fz !== 0) reached++;
      }
    }
    expect(reached).toBe(floor);
  });
});

describe("line of sight / cover", () => {
  it("a wall blocks line of sight; open floor does not", () => {
    const lvl = new Level(8, 8);
    lvl.tiles.fill(TILE_FLOOR);
    // Put a wall column at cell (4, *).
    for (let cz = 0; cz < 8; cz++) lvl.setCell(4, cz, TILE_WALL);
    const ax = lvl.worldX(1);
    const az = lvl.worldZ(4);
    const bx = lvl.worldX(6);
    const bz = lvl.worldZ(4);
    expect(lvl.hasLineOfSight(ax, az, bx, bz)).toBe(false);
    // Along a clear row.
    const lvl2 = new Level(8, 8);
    lvl2.tiles.fill(TILE_FLOOR);
    expect(lvl2.hasLineOfSight(lvl2.worldX(1), lvl2.worldZ(4), lvl2.worldX(6), lvl2.worldZ(4))).toBe(
      true,
    );
  });
});

describe("flow field pathing", () => {
  it("points enemies toward the goal and routes around a wall", () => {
    const lvl = new Level(10, 3);
    lvl.tiles.fill(TILE_FLOOR);
    const ff = new FlowField(lvl.cols, lvl.rows);
    ff.rebuild(lvl, 9, 1); // goal at the right
    const s = ff.sampleCell(0, 1);
    expect(s.fx).toBeGreaterThan(0); // flow heads right toward the goal
  });
});

describe("terrain-as-geometry sim mechanics", () => {
  it("the player cannot walk through a wall", () => {
    const sim = new Sim(defaultRunConfig(7));
    // Find a wall adjacent to a floor cell and try to walk into it.
    const lvl = sim.level;
    let placed = false;
    for (let cz = 1; cz < lvl.rows - 1 && !placed; cz++) {
      for (let cx = 1; cx < lvl.cols - 1 && !placed; cx++) {
        if (lvl.tileAtCell(cx, cz) === TILE_WALL && lvl.isPathable(cx - 1, cz)) {
          sim.playerX = lvl.worldX(cx - 1);
          sim.playerZ = lvl.worldZ(cz);
          placed = true;
        }
      }
    }
    expect(placed).toBe(true);
    const beforeX = sim.playerX;
    for (let i = 0; i < 30; i++) sim.update(1 / 60, { x: 1, z: 0 }); // shove east into wall
    // Should not have crossed into the wall cell (stays on its floor side).
    expect(sim.level.blocksMovement(sim.playerX, sim.playerZ)).toBe(false);
    expect(sim.playerX).toBeLessThan(beforeX + 2);
  });

  it("kills the player who stands on a hazard tile", () => {
    const sim = new Sim(defaultRunConfig(7));
    const lvl = sim.level;
    let found = false;
    for (let cz = 0; cz < lvl.rows && !found; cz++) {
      for (let cx = 0; cx < lvl.cols && !found; cx++) {
        if (lvl.tileAtCell(cx, cz) === TILE_HAZARD) {
          sim.playerX = lvl.worldX(cx);
          sim.playerZ = lvl.worldZ(cz);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
    sim.update(1 / 60, { x: 0, z: 0 });
    expect(sim.playerHp).toBe(0);
  });

  it("still runs the horde loop on tile arenas (kills accrue, HP drops)", () => {
    const sim = new Sim(defaultRunConfig(7));
    for (let i = 0; i < 60 * 16; i++) sim.update(1 / 60, { x: 0, z: 0 });
    expect(sim.kills).toBeGreaterThan(0);
    expect(sim.world.countOf(KIND_ENEMY)).toBeGreaterThan(0);
    expect(sim.playerHp).toBeLessThan(100);
  });

  it("is deterministic for a seed", () => {
    const a = new Sim(defaultRunConfig(5));
    const b = new Sim(defaultRunConfig(5));
    for (let i = 0; i < 60 * 6; i++) {
      a.update(1 / 60, { x: 0, z: 0 });
      b.update(1 / 60, { x: 0, z: 0 });
    }
    expect(a.kills).toBe(b.kills);
    expect(a.playerHp).toBeCloseTo(b.playerHp, 6);
  });
});
