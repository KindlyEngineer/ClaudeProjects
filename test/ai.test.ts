import { describe, it, expect } from "vitest";
import { decideUnit, exposureAt, sustainmentNeed } from "../src/sim/ai";
import { updateBelief } from "../src/sim/knowledge";
import { hexDistance } from "../src/sim/hex";
import type { ObjectiveDef } from "../src/data/types";
import { axial, find, openGame, place } from "./helpers";

const OBJ = axial(22, 4);
const objective: ObjectiveDef = { kind: "seize", turnLimit: 20, zone: [OBJ], attacker: "blue" };

describe("sustainment need", () => {
  it("is zero when topped up and high when out of ammo", () => {
    const s = openGame({ w: 26, h: 9, objective, units: [place("mech_assault", "blue", axial(4, 4))] });
    const mech = find(s, "mech_assault");
    expect(sustainmentNeed(mech).need).toBe(0);
    mech.ammo = mech.ammo.map(() => 0);
    const n = sustainmentNeed(mech);
    expect(n.need).toBeGreaterThan(0.5);
    expect(n.reason).toBe("low ammo");
  });
});

describe("mech commander — objective & sustainment", () => {
  it("a healthy mech with a clear field advances on the objective", () => {
    const s = openGame({ w: 26, h: 9, objective, units: [place("mech_assault", "blue", axial(4, 4))] });
    const mech = find(s, "mech_assault");
    const d = decideUnit(s, mech);
    expect(d.stance).toBe("advance");
    expect(hexDistance(d.destination, OBJ)).toBeLessThan(hexDistance(mech.hex, OBJ));
    expect(d.intent).toMatch(/advanc/i);
  });

  it("a mech low on ammo breaks contact toward supply instead of advancing", () => {
    const s = openGame({
      w: 26,
      h: 9,
      objective,
      units: [place("mech_assault", "blue", axial(12, 4)), place("supply", "blue", axial(1, 4))],
    });
    const mech = find(s, "mech_assault");
    mech.ammo = mech.ammo.map(() => 0);
    const d = decideUnit(s, mech);
    expect(d.stance).toBe("resupply");
    expect(d.intent).toMatch(/resupply.*ammo/i);
    // It moves back toward the supply line, not on toward the objective.
    expect(hexDistance(d.destination, OBJ)).toBeGreaterThanOrEqual(hexDistance(mech.hex, OBJ));
  });

  it("an immobilised mech holds in place", () => {
    const s = openGame({ w: 26, h: 9, objective, units: [place("mech_assault", "blue", axial(8, 4))] });
    const mech = find(s, "mech_assault");
    mech.crits.push("mobility");
    const d = decideUnit(s, mech);
    expect(d.stance).toBe("immobilised");
    expect(d.path).toHaveLength(0);
    expect(d.intent).toMatch(/immobilised/i);
  });
});

describe("mech commander — the player's levers (exposure)", () => {
  it("a visible enemy raises exposure; suppressing it or taking cover lowers it", () => {
    const s = openGame({
      w: 26,
      h: 9,
      objective,
      units: [place("mech_assault", "blue", axial(8, 4)), place("armor", "red", axial(12, 4))],
      terrain: [{ hex: axial(10, 6), terrain: "urban" }],
    });
    const enemy = find(s, "armor", "red");
    const hex = axial(10, 4);
    const open = exposureAt(s, "blue", hex, [enemy]);
    expect(open).toBeGreaterThan(0); // a known enemy in range is dangerous

    enemy.suppression = 8; // FIRES lever
    const suppressed = exposureAt(s, "blue", hex, [enemy]);
    expect(suppressed).toBeLessThan(open);

    enemy.suppression = 0;
    const covered = exposureAt(s, "blue", axial(10, 6), [enemy]); // urban cover
    const openSame = exposureAt(s, "blue", axial(10, 5), [enemy]);
    expect(covered).toBeLessThan(openSame);

    // Vision gate: an enemy the side cannot see contributes nothing.
    const unseen = exposureAt(s, "blue", hex, []);
    expect(unseen).toBeLessThan(open);
  });
});

describe("mech commander — the player's levers (support & clock)", () => {
  it("friendly support nearby lowers a hex's exposure (the screening lever)", () => {
    const hex = axial(9, 4);
    const make = (withScreen: boolean) =>
      openGame({
        w: 26,
        h: 9,
        objective,
        units: [
          place("mech_assault", "blue", axial(6, 4)),
          place("armor", "red", axial(12, 4), 3),
          ...(withScreen ? [place("armor", "blue", axial(9, 5))] : []), // a screen beside the hex
        ],
      });
    const s1 = make(false);
    const s2 = make(true);
    const e1 = find(s1, "armor", "red");
    const e2 = find(s2, "armor", "red");
    expect(exposureAt(s2, "blue", hex, [e2])).toBeLessThan(exposureAt(s1, "blue", hex, [e1]));
  });

  it("the clock adds urgency — near the deadline it pushes the objective over resupplying", () => {
    const s = openGame({
      w: 26,
      h: 9,
      objective, // attacker = blue, zone east
      units: [place("mech_assault", "blue", axial(12, 4)), place("supply", "blue", axial(1, 4))],
    });
    const mech = find(s, "mech_assault", "blue");
    mech.ammo = mech.ammo.map(() => 0); // low on ammo → would break contact to resupply
    const obj = s.objective.zone[0];
    s.turn = 1; // early: plenty of time → fall back and resupply
    const early = decideUnit(s, mech).destination;
    s.turn = s.objective.turnLimit; // late: no time left → drive on regardless
    const late = decideUnit(s, mech).destination;
    expect(hexDistance(late, obj)).toBeLessThan(hexDistance(early, obj));
  });
});

describe("mech commander — vision gating of targets", () => {
  it("won't engage an enemy in weapon range but out of sight until recon reveals it", () => {
    const base = () =>
      openGame({
        w: 28,
        h: 9,
        objective,
        units: [place("mech_assault", "blue", axial(8, 4)), place("infantry", "red", axial(16, 4))],
      });

    const blind = base();
    updateBelief(blind, "blue"); // the side forms its picture from what it can see
    const mechBlind = find(blind, "mech_assault");
    // The enemy is within the autocannon's range but beyond the mech's own sight.
    expect(decideUnit(blind, mechBlind).fireTargetId).toBeNull();

    // Drop a recon where it can see the enemy.
    const withRecon = openGame({
      w: 28,
      h: 9,
      objective,
      units: [
        place("mech_assault", "blue", axial(8, 4)),
        place("infantry", "red", axial(16, 4)),
        place("recon", "blue", axial(12, 4)),
      ],
    });
    updateBelief(withRecon, "blue"); // recon now contributes to the picture
    const mechSeen = find(withRecon, "mech_assault");
    const enemy = find(withRecon, "infantry", "red");
    expect(decideUnit(withRecon, mechSeen).fireTargetId).toBe(enemy.id);
  });
});

describe("capability-aware targeting (soundness)", () => {
  it("targets an enemy it can penetrate (the exposed rear) over one it would only bounce off", () => {
    const s = openGame({
      w: 14,
      h: 8,
      objective,
      units: [
        place("mech_assault", "blue", axial(5, 3), 0),
        place("mech_assault", "red", axial(8, 3), 3), // faces blue → blue strikes its FRONT (bounce)
        place("mech_assault", "red", axial(8, 5), 0), // faces away → blue strikes its REAR (penetrates)
      ],
    });
    const blue = find(s, "mech_assault", "blue");
    blue.crits.push("mobility"); // pin it so the choice is pure target selection
    updateBelief(s, "blue");
    const rear = s.units.find((u) => u.side === "red" && u.hex.q === axial(8, 5).q && u.hex.r === axial(8, 5).r)!;
    expect(decideUnit(s, blue).fireTargetId).toBe(rear.id);
  });
});

describe("mech commander — determinism", () => {
  it("the same state yields the same decision", () => {
    const s = openGame({
      w: 26,
      h: 9,
      objective,
      units: [place("mech_assault", "blue", axial(6, 4)), place("armor", "red", axial(14, 4))],
    });
    const mech = find(s, "mech_assault");
    expect(decideUnit(s, mech)).toEqual(decideUnit(s, mech));
  });
});
