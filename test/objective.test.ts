import { describe, it, expect } from "vitest";
import { attackerHoldsZone, evaluateOutcome } from "../src/sim/objective";
import type { ObjectiveDef } from "../src/data/types";
import { axial, find, openGame, place } from "./helpers";

const ZONE = axial(5, 2);
const objective: ObjectiveDef = { kind: "seize", turnLimit: 10, zone: [ZONE], attacker: "blue" };

describe("seize objective evaluation", () => {
  it("blue wins when a blue mech is on the zone", () => {
    const s = openGame({ objective, units: [place("mech_assault", "blue", ZONE), place("supply", "blue", axial(1, 1))] });
    expect(attackerHoldsZone(s)).toBe(true);
    expect(evaluateOutcome(s)).toBe("blue");
  });

  it("is ongoing while the mech is off-zone, in time, with units alive", () => {
    const s = openGame({
      objective,
      units: [place("mech_assault", "blue", axial(1, 2)), place("supply", "blue", axial(1, 1)), place("infantry", "red", axial(9, 2))],
    });
    expect(evaluateOutcome(s)).toBe("ongoing");
  });

  it("red wins on attrition: all blue mechs lost", () => {
    const s = openGame({ objective, units: [place("mech_assault", "blue", axial(1, 2)), place("supply", "blue", axial(1, 1))] });
    find(s, "mech_assault").structure = 0; // destroyed
    expect(evaluateOutcome(s)).toBe("red");
  });

  it("red wins on attrition: all blue support lost", () => {
    const s = openGame({ objective, units: [place("mech_assault", "blue", axial(1, 2))] }); // no support at all
    expect(evaluateOutcome(s)).toBe("red");
  });

  it("red wins when the clock expires unseized", () => {
    const s = openGame({
      objective,
      units: [place("mech_assault", "blue", axial(1, 2)), place("supply", "blue", axial(1, 1)), place("infantry", "red", axial(9, 2))],
    });
    s.turn = objective.turnLimit + 1;
    expect(evaluateOutcome(s)).toBe("red");
  });

  it("blue wins at once when the whole defence is destroyed (nobody left to contest)", () => {
    const s = openGame({
      objective,
      units: [
        place("mech_assault", "blue", axial(1, 2)),
        place("supply", "blue", axial(1, 1)),
        place("infantry", "red", axial(6, 2)),
      ],
    });
    expect(evaluateOutcome(s)).toBe("ongoing");
    find(s, "infantry", "red").structure = 0; // last defender falls
    expect(evaluateOutcome(s)).toBe("blue"); // no waiting for the walk-in or the clock
  });
});
