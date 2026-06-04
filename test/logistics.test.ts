import { describe, it, expect } from "vitest";
import { suppliedHexes, transferSupply, updateSupply } from "../src/sim/logistics";
import { beginTurn, nextPhase } from "../src/sim/turn";
import { canAttack, movePoints, resupplyUnit } from "../src/sim/actions";
import { unitType } from "../src/data/units";
import { hexKey } from "../src/sim/hex";
import { axial, find, openGame, place } from "./helpers";

describe("supply-line tracing", () => {
  it("a unit linked to its home edge is in supply; a cut-off unit goes dry", () => {
    // A water wall across column 3 severs the east half from the blue home edge.
    const wall = [0, 1, 2].map((row) => ({ hex: axial(3, row), terrain: "water" }));
    const s = openGame({
      w: 8,
      h: 3,
      units: [place("armor", "blue", axial(6, 1))],
      terrain: wall,
    });
    const armor = find(s, "armor");
    beginTurn(s);
    expect(armor.inSupply).toBe(false);
    expect(armor.dryTurns).toBe(1);
    beginTurn(s); // another turn cut off
    expect(armor.dryTurns).toBe(2);
  });

  it("a forward supply unit projects supply across the cut", () => {
    const wall = [0, 1, 2].map((row) => ({ hex: axial(3, row), terrain: "water" }));
    const s = openGame({
      w: 8,
      h: 3,
      units: [place("armor", "blue", axial(6, 1)), place("supply", "blue", axial(6, 2))],
      terrain: wall,
    });
    beginTurn(s);
    expect(find(s, "armor").inSupply).toBe(true); // the forward depot is a source
  });

  it("an enemy occupying the corridor cuts the line", () => {
    const s = openGame({
      w: 5,
      h: 1,
      units: [place("armor", "blue", axial(4, 0)), place("infantry", "red", axial(2, 0))],
    });
    const supplied = suppliedHexes(s, "blue");
    expect(supplied.has(hexKey(axial(0, 0)))).toBe(true); // home edge
    expect(supplied.has(hexKey(axial(4, 0)))).toBe(false); // blocked by the enemy at col 2
  });
});

describe("dry-out penalties", () => {
  it("halves movement after enough dry turns and eventually stops fire", () => {
    const s = openGame({
      units: [place("armor", "blue", axial(1, 2), 0), place("infantry", "red", axial(3, 2), 3)],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const armor = find(s, "armor");
    const full = movePoints(armor);
    expect(full).toBe(unitType("armor").move);
    armor.dryTurns = 2;
    expect(movePoints(armor)).toBe(Math.floor(unitType("armor").move / 2));
    armor.dryTurns = 3;
    expect(canAttack(s, armor, 0, find(s, "infantry", "red"))).toBe(false); // rationing
  });
});

describe("logistics invariants", () => {
  it("resupply never drives a supply budget negative", () => {
    const s = openGame({ units: [place("supply", "blue", axial(1, 2)), place("armor", "blue", axial(2, 2))] });
    const supply = find(s, "supply");
    const armor = find(s, "armor");
    supply.supply = 5; // tiny budget vs a big deficit
    armor.ammo[0] = 0;
    armor.fuel = 0;
    const r = transferSupply(supply, armor);
    expect(r.spent).toBeLessThanOrEqual(5);
    expect(supply.supply).toBe(0);
    expect(supply.supply).toBeGreaterThanOrEqual(0);
  });

  it("a long phased run terminates within the turn cap with no negative resources", () => {
    const cap = 8;
    const s = openGame({
      objective: { kind: "seize", turnLimit: cap, zone: [], attacker: "blue" },
      units: [place("supply", "blue", axial(1, 2)), place("armor", "blue", axial(2, 2)), place("infantry", "red", axial(4, 2), 3)],
    });
    beginTurn(s);
    let guard = 0;
    while (s.turn <= cap && guard < 500) {
      if (s.phase === "maneuver") {
        const supply = find(s, "supply");
        if (!supply.actedThisTurn) resupplyUnit(s, supply, find(s, "armor"));
      }
      for (const u of s.units) {
        expect(u.fuel).toBeGreaterThanOrEqual(0);
        expect(u.supply).toBeGreaterThanOrEqual(0);
        expect(Math.min(0, ...u.ammo)).toBe(0); // no negative ammo
      }
      nextPhase(s);
      guard++;
    }
    expect(s.turn).toBeGreaterThan(cap); // it terminated
    expect(guard).toBeLessThan(500); // ...without spinning
  });

  it("updateSupply marks both sides", () => {
    const s = openGame({ units: [place("armor", "blue", axial(1, 1)), place("armor", "red", axial(10, 1))] });
    updateSupply(s);
    expect(find(s, "armor", "blue").inSupply).toBe(true);
    expect(find(s, "armor", "red").inSupply).toBe(true); // red traces to its own (east) edge
  });
});
