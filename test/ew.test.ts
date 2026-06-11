import { describe, it, expect } from "vitest";
import { canDeployDecoy, deployDecoy } from "../src/sim/actions";
import { exposureAt } from "../src/sim/ai";
import { believedEnemies, updateBelief, visibleSightings } from "../src/sim/knowledge";
import { canSee, jammedFor, visibleEnemies } from "../src/sim/vision";
import { beginTurn } from "../src/sim/turn";
import { RULES } from "../src/data/rules";
import { axial, find, openGame, place } from "./helpers";

// Horizon 2 — ELECTRONIC WARFARE (ruling D15): attacks on the game's defining
// substrate, the belief map. The jammer shrinks what enemy sensors can reach;
// the decoy plants a phantom the enemy reasons over but can never hit. Both
// run through the SAME vision/belief machinery as everything else.

describe("the jammer — ground the enemy can't read", () => {
  const field = () =>
    openGame({
      w: 16,
      units: [
        place("recon", "blue", axial(2, 2)), // vision 12
        place("infantry", "red", axial(10, 2), 3),
        place("ew_vehicle", "red", axial(9, 2), 3),
      ],
    });

  it("hexes under the umbrella read only at burn-through range", () => {
    const s = field();
    const recon = find(s, "recon");
    const hidden = find(s, "infantry", "red"); // 8 hexes out, inside the umbrella
    expect(jammedFor(s, "blue", hidden.hex)).toBe(true);
    expect(canSee(s, recon, hidden.hex)).toBe(false); // 8 > burn-through

    const ew = find(s, "ew_vehicle", "red");
    ew.structure = 0; // kill the jammer…
    expect(jammedFor(s, "blue", hidden.hex)).toBe(false);
    expect(canSee(s, recon, hidden.hex)).toBe(true); // …and the picture clears
  });

  it("a sensors crit silences the suite; the owner's own eyes are untouched", () => {
    const s = field();
    const recon = find(s, "recon");
    const hidden = find(s, "infantry", "red");
    const ew = find(s, "ew_vehicle", "red");
    ew.crits.push("sensors"); // the suite IS the weapon
    expect(canSee(s, recon, hidden.hex)).toBe(true);
    ew.crits = [];
    expect(canSee(s, recon, hidden.hex)).toBe(false);
    // The jam never blinds its own side.
    expect(jammedFor(s, "red", hidden.hex)).toBe(false);
  });

  it("closing in burns through; overflights see over it entirely", () => {
    const s = openGame({
      w: 16,
      units: [
        place("infantry", "blue", axial(8, 2)), // 2 hexes out — inside burn-through
        place("infantry", "red", axial(10, 2), 3),
        place("ew_vehicle", "red", axial(9, 2), 3),
      ],
    });
    const close = find(s, "infantry", "blue");
    const hidden = find(s, "infantry", "red");
    expect(canSee(s, close, hidden.hex)).toBe(true); // 2 ≤ burn-through 3

    const far = openGame({
      w: 16,
      units: [place("recon", "blue", axial(2, 2)), place("infantry", "red", axial(10, 2), 3), place("ew_vehicle", "red", axial(9, 2), 3)],
    });
    expect(visibleEnemies(far, "blue").length).toBe(0); // jammed
    far.airRecon.push({ side: "blue", center: axial(10, 2), radius: 4, calledTurn: far.turn });
    expect(visibleEnemies(far, "blue").length).toBeGreaterThan(0); // air flies over the jam
  });
});

describe("the decoy — a lie in the enemy's belief", () => {
  const field = () =>
    openGame({
      w: 16,
      units: [
        place("ew_vehicle", "blue", axial(3, 2), 0, "player"),
        place("armor", "red", axial(14, 2), 3, "ai"),
      ],
    });

  it("plants a phantom the enemy believes but can never fire on", () => {
    const s = field();
    beginTurn(s);
    const ew = find(s, "ew_vehicle");
    expect(ew.ewCharges).toBe(2);
    const target = axial(7, 2);
    expect(deployDecoy(s, ew, target).ok).toBe(true);

    const believed = believedEnemies(s, "red");
    const phantom = believed.find((b) => b.id < 0)!;
    expect(phantom).toBeDefined();
    expect(phantom.typeId).toBe(RULES.ew.decoyType); // it fakes the scariest signature
    expect(phantom.side).toBe("blue");
    expect(visibleSightings(s, "red").some((v) => v.id < 0)).toBe(false); // never a firing solution

    expect(ew.ewCharges).toBe(1);
    expect(ew.actedThisTurn).toBe(true);
    expect(canDeployDecoy(s, ew, target).reason).toBe("already acted");
  });

  it("the charges and the range are real limits; a broken suite projects nothing", () => {
    const s = field();
    beginTurn(s);
    const ew = find(s, "ew_vehicle");
    expect(canDeployDecoy(s, ew, axial(12, 2)).reason).toBe("out of projection range"); // 9 > 6
    ew.ewCharges = 0;
    expect(canDeployDecoy(s, ew, axial(7, 2)).reason).toBe("no decoy charges left");
    ew.ewCharges = 2;
    ew.crits.push("sensors");
    expect(canDeployDecoy(s, ew, axial(7, 2)).reason).toBe("EW suite is out");
  });

  it("the phantom raises the enemy's perceived threat — the lie does work", () => {
    const s = field();
    beginTurn(s);
    const ew = find(s, "ew_vehicle");
    const near = axial(8, 2); // ground beside where the phantom will stand
    const before = exposureAt(s, "red", near, believedEnemies(s, "red"));
    deployDecoy(s, ew, axial(7, 2));
    const after = exposureAt(s, "red", near, believedEnemies(s, "red"));
    expect(after).toBeGreaterThan(before); // red now pays to approach that ground
  });

  it("scouting the hex blows the decoy; unscouted, it decays like any memory", () => {
    const s = openGame({
      w: 16,
      units: [
        place("ew_vehicle", "blue", axial(3, 2), 0, "player"),
        place("recon", "red", axial(14, 2), 3, "ai"),
      ],
    });
    beginTurn(s);
    const ew = find(s, "ew_vehicle");
    deployDecoy(s, ew, axial(7, 2));
    expect(believedEnemies(s, "red").some((b) => b.id < 0)).toBe(true);

    // Red's recon (vision 12, 7 hexes out) has eyes on the hex — nothing there.
    updateBelief(s, "red");
    expect(believedEnemies(s, "red").some((b) => b.id < 0)).toBe(false);

    // Replant far from any eyes: it survives the turn, then ages out.
    const recon = find(s, "recon", "red");
    recon.structure = 0; // no observers left
    ew.actedThisTurn = false;
    deployDecoy(s, ew, axial(7, 2));
    updateBelief(s, "red");
    expect(believedEnemies(s, "red").some((b) => b.id < 0)).toBe(true); // unscouted — the lie holds
    s.turn += RULES.commander.memoryTurns + 1;
    updateBelief(s, "red");
    expect(believedEnemies(s, "red").some((b) => b.id < 0)).toBe(false); // stale, like any sighting
  });
});
