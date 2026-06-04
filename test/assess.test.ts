import { describe, it, expect } from "vitest";
import { assess, updatePostures } from "../src/sim/assess";
import { updateBelief } from "../src/sim/knowledge";
import { RULES } from "../src/data/rules";
import type { ObjectiveDef } from "../src/data/types";
import { axial, openGame, place } from "./helpers";

const objective: ObjectiveDef = { kind: "seize", turnLimit: 20, zone: [axial(11, 2)], attacker: "blue" };
const opts = { w: 14, h: 5, objective };

describe("situational assessment — aggression is earned, not assumed", () => {
  it("with no contact, the defender has no basis to attack — it probes for information", () => {
    // Blue is far west, beyond the red mech's sight (no recon out).
    const s = openGame({ ...opts, units: [place("mech_assault", "blue", axial(0, 2)), place("mech_assault", "red", axial(11, 2), 3)] });
    updateBelief(s, "red");
    expect(assess(s, "red").haveContact).toBe(false);
    updatePostures(s);
    expect(s.posture.red.kind).toBe("probe"); // go gain information, not attack blindly
  });

  it("after scouting a lone, isolated attacker it perceives an advantage and commits", () => {
    const s = openGame({
      ...opts,
      units: [
        place("mech_assault", "blue", axial(1, 2)), // a single, unsupported attacker
        place("recon", "red", axial(5, 2), 3), // pushed forward → scouts the approach + sees it
        place("mech_assault", "red", axial(11, 2), 3),
        place("armor", "red", axial(11, 3), 3),
        place("infantry", "red", axial(11, 1), 3),
      ],
    });
    updateBelief(s, "red");
    const a = assess(s, "red");
    expect(a.haveContact).toBe(true);
    expect(a.scouted).toBeGreaterThanOrEqual(RULES.commander.minScoutToCommit);
    expect(a.advantage).toBeGreaterThan(RULES.commander.counterAdvantage);
    updatePostures(s);
    expect(s.posture.red.kind).toBe("counter"); // earned aggression
  });

  it("the SAME scouting against a strong, supported force yields no advantage — it holds", () => {
    const s = openGame({
      ...opts,
      units: [
        place("mech_assault", "blue", axial(1, 2)),
        place("armor", "blue", axial(1, 1)),
        place("infantry", "blue", axial(1, 3)), // now a combined-arms attack
        place("recon", "red", axial(5, 2), 3),
        place("mech_assault", "red", axial(11, 2), 3),
        place("armor", "red", axial(11, 3), 3),
        place("infantry", "red", axial(11, 1), 3),
      ],
    });
    updateBelief(s, "red");
    const a = assess(s, "red");
    expect(a.haveContact).toBe(true);
    expect(a.advantage).toBeLessThan(RULES.commander.counterAdvantage);
    updatePostures(s);
    expect(s.posture.red.kind).not.toBe("counter"); // no perceived edge → stays defensive
  });

  it("is deterministic for a state", () => {
    const s = openGame({ ...opts, units: [place("mech_assault", "blue", axial(3, 2)), place("recon", "red", axial(6, 2), 3), place("mech_assault", "red", axial(11, 2), 3)] });
    updateBelief(s, "red");
    expect(assess(s, "red")).toEqual(assess(s, "red"));
  });
});
