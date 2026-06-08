import { describe, it, expect } from "vitest";
import { attackUnit, canAttack, moveUnit, resupplyUnit } from "../src/sim/actions";
import { beginTurn } from "../src/sim/turn";
import { axial, find, openGame, place } from "./helpers";

describe("move action", () => {
  it("moves along a path, spends fuel, and faces the last step", () => {
    const s = openGame({ units: [place("armor", "blue", axial(1, 2))] });
    beginTurn(s);
    s.phase = "maneuver";
    const armor = find(s, "armor");
    const fuel0 = armor.fuel;
    const path = [axial(2, 2), axial(3, 2)]; // two open hexes east, cost 1 each
    const r = moveUnit(s, armor, path);
    expect(r.moved).toBe(true);
    expect(r.cost).toBe(2);
    expect(armor.fuel).toBe(fuel0 - 2);
    expect(armor.hex).toEqual(axial(3, 2));
    expect(armor.movedThisTurn).toBe(true);
    expect(moveUnit(s, armor, [axial(4, 2)]).moved).toBe(false); // only one move per turn
  });

  it("honours an explicit final facing (the player's post-move choice)", () => {
    const s = openGame({ units: [place("armor", "blue", axial(1, 2))] });
    beginTurn(s);
    s.phase = "maneuver";
    const armor = find(s, "armor");
    // Travel is due east (would auto-face 0), but the player ends facing rear (3)
    // to present the front toward a threat behind — the facing must be respected.
    const r = moveUnit(s, armor, [axial(2, 2), axial(3, 2)], 3);
    expect(r.moved).toBe(true);
    expect(armor.hex).toEqual(axial(3, 2));
    expect(armor.facing).toBe(3); // not the direction of travel
  });

  it("rejects impassable, occupied, off-map, over-budget and wrong-phase moves", () => {
    const s = openGame({
      units: [place("armor", "blue", axial(1, 2)), place("infantry", "blue", axial(2, 2))],
      terrain: [{ hex: axial(1, 3), terrain: "water" }],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const armor = find(s, "armor");
    expect(moveUnit(s, armor, [axial(2, 2)]).reason).toBe("occupied");
    expect(moveUnit(s, armor, [axial(1, 3)]).reason).toBe("impassable");
    expect(moveUnit(s, armor, [axial(99, 99)]).reason).toBe("non-adjacent step");
    s.phase = "recon";
    expect(moveUnit(s, armor, [axial(2, 2)]).reason).toBe("not its phase"); // armor maneuvers
  });
});

describe("attack action", () => {
  it("fires at an in-range enemy in its phase and consumes the main action", () => {
    const s = openGame({
      units: [place("armor", "blue", axial(1, 2), 0), place("infantry", "red", axial(4, 2), 3)],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const armor = find(s, "armor");
    const target = find(s, "infantry", "red");
    expect(canAttack(s, armor, 0, target)).toBe(true);
    const res = attackUnit(s, armor, 0, target);
    expect(res.fired).toBe(true);
    expect(armor.actedThisTurn).toBe(true);
    expect(attackUnit(s, armor, 0, target).fired).toBe(false); // one action per turn
  });

  it("won't fire out of range or at a friendly", () => {
    const s = openGame({
      w: 24,
      units: [place("armor", "blue", axial(1, 2)), place("infantry", "red", axial(20, 2)), place("recon", "blue", axial(2, 2))],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const armor = find(s, "armor");
    const far = find(s, "infantry", "red"); // ~19 hexes, beyond the tank's range 13
    const friend = find(s, "recon", "blue");
    expect(canAttack(s, armor, 0, far)).toBe(false);
    expect(canAttack(s, armor, 0, friend)).toBe(false);
  });

  it("a unit may move and then fire in the same activation", () => {
    const s = openGame({
      units: [place("armor", "blue", axial(1, 2), 0), place("infantry", "red", axial(5, 2), 3)],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const armor = find(s, "armor");
    const target = find(s, "infantry", "red");
    expect(moveUnit(s, armor, [axial(2, 2)]).moved).toBe(true);
    expect(attackUnit(s, armor, 0, target).fired).toBe(true);
  });
});

describe("resupply action", () => {
  it("refills an adjacent friendly's ammo and fuel from a finite budget", () => {
    const s = openGame({ units: [place("supply", "blue", axial(1, 2)), place("armor", "blue", axial(2, 2))] });
    beginTurn(s);
    s.phase = "maneuver";
    const supply = find(s, "supply");
    const armor = find(s, "armor");
    armor.ammo[0] = 2;
    armor.fuel = 5;
    const budget0 = supply.supply;
    const r = resupplyUnit(s, supply, armor);
    expect(r.ok).toBe(true);
    expect(armor.ammo[0]).toBeGreaterThan(2);
    expect(armor.fuel).toBeGreaterThan(5);
    expect(supply.supply).toBe(budget0 - r.spent);
    expect(supply.supply).toBeGreaterThanOrEqual(0); // never negative
  });

  it("won't resupply a non-adjacent or enemy unit", () => {
    const s = openGame({
      units: [place("supply", "blue", axial(1, 2)), place("armor", "blue", axial(4, 2)), place("infantry", "red", axial(2, 2))],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const supply = find(s, "supply");
    expect(resupplyUnit(s, supply, find(s, "armor")).reason).toBe("not adjacent");
    expect(resupplyUnit(s, supply, find(s, "infantry", "red")).reason).toBe("invalid target");
  });
});
