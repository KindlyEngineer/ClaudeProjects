import { describe, it, expect } from "vitest";
import { canSee, hasLineOfSight, isScouted, visibleEnemies } from "../src/sim/vision";
import { hexLine } from "../src/sim/hex";
import { axial, find, openGame, place } from "./helpers";

describe("line of sight", () => {
  it("blocking terrain between two hexes breaks LOS; endpoints don't", () => {
    const a = axial(2, 3);
    const b = axial(8, 3);
    const mid = hexLine(a, b)[3]; // somewhere between
    const clear = openGame({ w: 14, h: 7, units: [] });
    const blocked = openGame({ w: 14, h: 7, units: [], terrain: [{ hex: mid, terrain: "woods" }] });
    expect(hasLineOfSight(clear, a, b)).toBe(true);
    expect(hasLineOfSight(blocked, a, b)).toBe(false);
  });
});

describe("per-side vision", () => {
  it("sees an enemy within range and LOS, not one beyond sight range", () => {
    const s = openGame({
      w: 24,
      h: 7,
      units: [
        place("recon", "blue", axial(2, 3)), // vision 12
        place("infantry", "red", axial(8, 3)), // ~6 hexes: visible
        place("armor", "red", axial(20, 3)), // ~18 hexes: beyond sight
      ],
    });
    const seen = visibleEnemies(s, "blue").map((u) => u.typeId);
    expect(seen).toContain("infantry");
    expect(seen).not.toContain("armor");
  });

  it("a blue unit can see a hex it is in range of and has LOS to", () => {
    const s = openGame({ w: 14, h: 7, units: [place("recon", "blue", axial(2, 3))] });
    const recon = find(s, "recon");
    expect(canSee(s, recon, axial(6, 3))).toBe(true);
    expect(isScouted(s, "blue", axial(6, 3))).toBe(true);
    expect(isScouted(s, "blue", axial(23, 3))).toBe(false); // out of everyone's sight
  });
});
