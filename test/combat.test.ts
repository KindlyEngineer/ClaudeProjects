import { describe, it, expect } from "vitest";
import {
  arcArmor,
  attackArc,
  hitChance,
  inRange,
  penetrates,
  resolveAttack,
} from "../src/sim/combat";
import { CRIT_TABLE, pickCrit } from "../src/data/crits";
import { unitType } from "../src/data/units";
import type { MapDef } from "../src/data/types";
import type { GameState, UnitInstance } from "../src/sim/state";
import { DIRECTIONS, type Direction, type Hex } from "../src/sim/hex";

let idc = 1;
function mkUnit(typeId: string, hex: Hex, facing: Direction, side: "blue" | "red" = "red"): UnitInstance {
  const t = unitType(typeId);
  return {
    id: idc++,
    typeId,
    side,
    controller: "ai",
    hex,
    facing,
    structure: t.structure,
    ammo: t.weapons.map((w) => w.ammoMax),
    fuel: t.fuelMax,
    suppression: 0,
    crits: [],
    supply: t.supplyCapacity ?? 0,
    movedThisTurn: false,
    actedThisTurn: false,
    reserved: false,
    inSupply: true,
    dryTurns: 0,
  };
}

function mkState(seed: number, units: UnitInstance[]): GameState {
  return {
    map: {} as unknown as MapDef,
    cells: new Map(), // empty → no terrain cover, isolates the combat math
    units,
    turn: 1,
    phase: "fires",
    objective: { kind: "seize", turnLimit: 10, zone: [], attacker: "blue" },
    outcome: "ongoing",
    seed,
    rngState: seed >>> 0,
    rollLog: [],
    intents: {},
    belief: { blue: new Map(), red: new Map() },
  };
}

const ORIGIN: Hex = { q: 0, r: 0 };

describe("facing armour & penetration (pure)", () => {
  it("reads the struck arc from attacker position and target facing", () => {
    const target = mkUnit("mech_assault", ORIGIN, 0); // faces east (dir 0)
    const front = mkUnit("armor", DIRECTIONS[0], 3);
    const rear = mkUnit("armor", DIRECTIONS[3], 3);
    expect(attackArc(front, target)).toBe("front");
    expect(attackArc(rear, target)).toBe("rear");
    const armor = unitType("mech_assault").armor;
    expect(arcArmor(front, target)).toBe(armor.front);
    expect(arcArmor(rear, target)).toBe(armor.rear);
  });

  it("a mid-penetration shot bounces off the front but punches the rear", () => {
    const armor = unitType("mech_assault").armor; // front 9 / side 6 / rear 4
    const pen = 5; // artillery-class penetration, between rear and front
    expect(penetrates(pen, armor.front)).toBe(false);
    expect(penetrates(pen, armor.rear)).toBe(true);
  });
});

describe("resolveAttack", () => {
  it("consumes one round of ammo when it fires", () => {
    const attacker = mkUnit("armor", DIRECTIONS[3], 3, "blue");
    const target = mkUnit("mech_assault", ORIGIN, 0);
    const state = mkState(1, [attacker, target]);
    const before = attacker.ammo[0];
    resolveAttack(state, attacker, 0, target);
    expect(attacker.ammo[0]).toBe(before - 1);
  });

  it("facing decides outcomes: front shots never wound, rear shots do", () => {
    // Artillery (pen 5) vs mech (front 9, rear 4). Fire many; only the rear hurts.
    const maxStruct = unitType("mech_assault").structure;

    const frontAtk = mkUnit("artillery", DIRECTIONS[0], 3, "blue");
    const frontTgt = mkUnit("mech_assault", ORIGIN, 0);
    frontAtk.ammo[0] = 999;
    const s1 = mkState(7, [frontAtk, frontTgt]);
    for (let i = 0; i < 200; i++) resolveAttack(s1, frontAtk, 0, frontTgt);
    expect(frontTgt.structure).toBe(maxStruct); // every hit bounced

    const rearAtk = mkUnit("artillery", DIRECTIONS[3], 3, "blue");
    const rearTgt = mkUnit("mech_assault", ORIGIN, 0);
    rearAtk.ammo[0] = 999;
    const s2 = mkState(7, [rearAtk, rearTgt]);
    let shots = 0;
    while (rearTgt.structure > 0 && shots < 200) {
      resolveAttack(s2, rearAtk, 0, rearTgt);
      shots++;
    }
    expect(rearTgt.structure).toBeLessThan(maxStruct); // rear shots penetrated
  });

  it("logs every roll and is deterministic for a seed", () => {
    const run = () => {
      const atk = mkUnit("armor", DIRECTIONS[3], 3, "blue"); // pen 9 vs rear 4 → penetrates
      const tgt = mkUnit("mech_assault", ORIGIN, 0);
      const st = mkState(42, [atk, tgt]);
      for (let i = 0; i < 15; i++) resolveAttack(st, atk, 0, tgt);
      return st;
    };
    const a = run();
    const b = run();
    expect(a.rollLog.map((r) => r.value)).toEqual(b.rollLog.map((r) => r.value));
    expect(a.units[1].structure).toBe(b.units[1].structure);
    expect(a.units[1].crits).toEqual(b.units[1].crits);
    // Rolls are tagged and attributed to the turn.
    expect(a.rollLog.length).toBeGreaterThan(0);
    expect(a.rollLog.every((r) => r.turn === 1)).toBe(true);
    expect(a.rollLog.some((r) => r.kind === "to-hit")).toBe(true);
    expect(a.rollLog.some((r) => r.kind === "crit-occurs")).toBe(true);
  });

  it("accumulated suppression breaks the crew (shaken) even without penetration", () => {
    // Artillery (pen 5, suppression 6) into the mech's front (armour 9): bounces,
    // so no structure loss, but suppression piles up to the morale break.
    const atk = mkUnit("artillery", DIRECTIONS[0], 3, "blue");
    const tgt = mkUnit("mech_assault", ORIGIN, 0);
    atk.ammo[0] = 999;
    const st = mkState(3, [atk, tgt]);
    for (let i = 0; i < 60; i++) resolveAttack(st, atk, 0, tgt);
    expect(tgt.structure).toBe(unitType("mech_assault").structure); // never penetrated
    expect(tgt.crits).toContain("shaken");
    expect(tgt.suppression).toBeGreaterThanOrEqual(8);
  });

  it("won't fire with no ammo or a weapon crit", () => {
    const tgt = mkUnit("mech_assault", ORIGIN, 0);
    const dry = mkUnit("armor", DIRECTIONS[3], 3, "blue");
    dry.ammo[0] = 0;
    const st = mkState(1, [dry, tgt]);
    expect(resolveAttack(st, dry, 0, tgt).fired).toBe(false);

    const broken = mkUnit("armor", DIRECTIONS[3], 3, "blue");
    broken.crits.push("weapon");
    expect(resolveAttack(st, broken, 0, tgt).fired).toBe(false);
  });
});

describe("hit chance & range", () => {
  it("terrain cover lowers the hit chance", () => {
    const atk = mkUnit("armor", DIRECTIONS[3], 3, "blue");
    const tgt = mkUnit("mech_assault", ORIGIN, 0);
    const weapon = unitType("armor").weapons[0];
    const open = mkState(1, [atk, tgt]);
    const inCover = mkState(1, [atk, tgt]);
    inCover.cells.set("0,0", { hex: ORIGIN, terrain: "urban", elevation: 0 }); // cover 3
    expect(hitChance(inCover, atk, weapon, tgt)).toBeLessThan(hitChance(open, atk, weapon, tgt));
  });

  it("respects the weapon range band", () => {
    const arty = unitType("artillery").weapons[0]; // rangeMin 4, rangeMax 34
    const atk = mkUnit("artillery", ORIGIN, 0, "blue");
    const near = mkUnit("mech_assault", { q: 2, r: 0 }, 0); // dist 2 < min
    const far = mkUnit("mech_assault", { q: 8, r: 0 }, 0); // dist 8 in band
    expect(inRange(atk, arty, near)).toBe(false);
    expect(inRange(atk, arty, far)).toBe(true);
  });
});

describe("crit table", () => {
  it("covers all four states across the roll range", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(pickCrit(i / 100));
    expect(seen).toEqual(new Set(CRIT_TABLE.map((e) => e.state)));
  });
});
