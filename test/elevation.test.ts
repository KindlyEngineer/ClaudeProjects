import { describe, it, expect } from "vitest";
import { climbCost, heightClearsLine, heightHitBonus } from "../src/sim/elevation";
import { hitChance } from "../src/sim/combat";
import { canSee } from "../src/sim/vision";
import { reachable } from "../src/sim/pathing";
import { moveUnit } from "../src/sim/actions";
import { beginTurn } from "../src/sim/turn";
import { hexKey } from "../src/sim/hex";
import { unitType } from "../src/data/units";
import type { Hex } from "../src/sim/hex";
import { openGame, place, find, axial } from "./helpers";

// Mechanical elevation (v1): the heightmap drives LOS, to-hit and movement.
// openGame is flat (elevation 0) so we raise specific hexes to isolate each rule.

function raise(s: ReturnType<typeof openGame>, hex: Hex, to: number): void {
  Object.assign(s.cells.get(hexKey(hex))!, { elevation: to }); // MapCell.elevation is readonly
}

describe("elevation — line of sight over ridges", () => {
  it("a ridge between observer and target breaks the line; flat ground doesn't", () => {
    const s = openGame({ w: 12, units: [place("recon", "blue", axial(1, 2)), place("infantry", "red", axial(7, 2), 3)] });
    beginTurn(s);
    const recon = find(s, "recon");
    const enemy = find(s, "infantry", "red");
    expect(canSee(s, recon, enemy.hex)).toBe(true); // flat → clear

    raise(s, axial(4, 2), 6); // a hill on the sightline, well above eye height
    expect(heightClearsLine(s, recon.hex, enemy.hex)).toBe(false);
    expect(canSee(s, recon, enemy.hex)).toBe(false); // blinded by the crest
  });

  it("standing ON the high ground restores the view over the same ridge", () => {
    const s = openGame({ w: 12, units: [place("recon", "blue", axial(1, 2)), place("infantry", "red", axial(7, 2), 3)] });
    beginTurn(s);
    const recon = find(s, "recon");
    const enemy = find(s, "infantry", "red");
    raise(s, axial(4, 2), 6);
    raise(s, recon.hex, 8); // climb above the ridge — eyeline now clears it
    expect(canSee(s, recon, enemy.hex)).toBe(true);
  });
});

describe("elevation — height advantage in the fight", () => {
  it("firing downhill raises the hit chance; uphill gives no bonus", () => {
    const s = openGame({ units: [place("armor", "blue", axial(1, 2), 0), place("infantry", "red", axial(3, 2), 3)] });
    beginTurn(s);
    s.phase = "maneuver";
    const armor = find(s, "armor");
    const enemy = find(s, "infantry", "red");
    const weapon = unitType(armor.typeId).weapons[0];
    const flat = hitChance(s, armor, weapon, enemy);

    raise(s, armor.hex, 3); // the tank takes the high ground
    expect(heightHitBonus(s, armor.hex, enemy.hex)).toBeGreaterThan(0);
    expect(hitChance(s, armor, weapon, enemy)).toBeGreaterThan(flat);
    // From the enemy's lower position the bonus is zero (no uphill advantage).
    expect(heightHitBonus(s, enemy.hex, armor.hex)).toBe(0);
  });

  it("the height bonus is capped (high ground helps, doesn't auto-win)", () => {
    const s = openGame({ units: [place("armor", "blue", axial(1, 2)), place("infantry", "red", axial(3, 2), 3)] });
    raise(s, axial(1, 2), 50); // absurd cliff
    expect(heightHitBonus(s, axial(1, 2), axial(3, 2))).toBeLessThanOrEqual(0.08 + 1e-9);
  });
});

describe("elevation — climbing costs movement", () => {
  it("climbing uphill costs extra MP; descending is free", () => {
    const s = openGame({ units: [place("recon", "blue", axial(2, 2))] });
    beginTurn(s);
    const recon = find(s, "recon");
    expect(climbCost(s, axial(2, 2), axial(3, 2))).toBe(0); // flat
    raise(s, axial(3, 2), 2);
    expect(climbCost(s, axial(2, 2), axial(3, 2))).toBeGreaterThan(0); // up
    expect(climbCost(s, axial(3, 2), axial(2, 2))).toBe(0); // back down — free

    // Reachability pays the climb: the uphill hex costs base + the surcharge.
    const reach = reachable(s, recon);
    const node = reach.get(hexKey(axial(3, 2)))!;
    expect(node.cost).toBeCloseTo(1 + climbCost(s, axial(2, 2), axial(3, 2)), 6);
  });

  it("a real climb can exhaust fuel a flat move wouldn't (move pays the surcharge)", () => {
    const s = openGame({ units: [place("recon", "blue", axial(2, 2))] });
    beginTurn(s);
    const recon = find(s, "recon");
    recon.fuel = 1; // just enough for one flat step
    raise(s, axial(3, 2), 3); // make the next hex a steep climb (cost > 1)
    const r = moveUnit(s, recon, [axial(3, 2)]);
    expect(r.moved).toBe(false);
    expect(r.reason).toBe("out of fuel"); // the climb tipped it over budget
    expect(recon.fuel).toBe(1); // unchanged — never went negative
  });
});
