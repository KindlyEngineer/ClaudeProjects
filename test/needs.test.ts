import { describe, it, expect } from "vitest";
import { commanderNeeds } from "../src/sim/needs";
import { beginTurn } from "../src/sim/turn";
import { axial, find, openGame, place } from "./helpers";

// The commander-needs readout: read-only legibility derived from the SAME
// signals the AI acts on. The player can't task the mechs; this is how they
// know what the autonomous main effort needs from them.

describe("commander needs (legibility surface)", () => {
  it("flags a mech's sustainment problem with its reason", () => {
    const s = openGame({
      w: 16,
      objective: { kind: "seize", turnLimit: 10, zone: [axial(14, 2)], attacker: "blue" },
      units: [place("mech_assault", "blue", axial(2, 2)), place("infantry", "red", axial(14, 2), 3)],
    });
    beginTurn(s);
    const mech = find(s, "mech_assault");
    expect(commanderNeeds(s, "blue").some((n) => n.text.includes("resupply"))).toBe(false); // fresh mech: quiet

    mech.ammo = mech.ammo.map(() => 0); // bone dry
    const needs = commanderNeeds(s, "blue");
    const ammoNeed = needs.find((n) => n.text.includes("low ammo"));
    expect(ammoNeed).toBeDefined();
    expect(ammoNeed!.urgency).toBe("warn");
  });

  it("asks for recon when the approach is unscouted, and reports the assault", () => {
    const s = openGame({
      w: 16,
      objective: { kind: "seize", turnLimit: 10, zone: [axial(14, 2)], attacker: "blue" },
      units: [place("mech_assault", "blue", axial(2, 2)), place("infantry", "red", axial(14, 2), 3)],
    });
    beginTurn(s);
    expect(commanderNeeds(s, "blue").some((n) => n.text.includes("recon"))).toBe(true); // blind → wants eyes

    s.posture.blue = { kind: "assault", since: s.turn, targetId: null };
    expect(commanderNeeds(s, "blue").some((n) => n.text.includes("Assault committed"))).toBe(true);
  });

  it("flags a cut-off or shaken mech", () => {
    const s = openGame({
      w: 16,
      objective: { kind: "seize", turnLimit: 10, zone: [axial(14, 2)], attacker: "blue" },
      units: [place("mech_assault", "blue", axial(2, 2)), place("infantry", "red", axial(14, 2), 3)],
    });
    beginTurn(s);
    const mech = find(s, "mech_assault");
    mech.inSupply = false;
    mech.crits.push("shaken");
    const needs = commanderNeeds(s, "blue");
    expect(needs.some((n) => n.text.includes("CUT OFF"))).toBe(true);
    expect(needs.some((n) => n.text.includes("shaken"))).toBe(true);
  });

  it("is silent about mechs the side doesn't have (support-only forces)", () => {
    const s = openGame({ units: [place("recon", "blue", axial(2, 2), 0, "player")] });
    beginTurn(s);
    expect(commanderNeeds(s, "blue")).toEqual([]);
  });
});
