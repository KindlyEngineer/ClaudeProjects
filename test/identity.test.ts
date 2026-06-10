import { describe, it, expect } from "vitest";
import { createGame, unitLabel } from "../src/sim/state";
import { commanderNeeds } from "../src/sim/needs";
import { cardModel } from "../src/ui/control";
import { decideUnit } from "../src/sim/ai";
import { planForce } from "../src/sim/plan";
import { beginTurn } from "../src/sim/turn";
import { unitType } from "../src/data/units";
import { hexKey } from "../src/sim/hex";
import { MAP01 } from "../src/data/maps/map01";
import { openGame, place, find, axial } from "./helpers";

// The autonomous main effort has an identity (call signs) and a terrain-aware
// voice — the legibility/soul layer. Call signs are deterministic, mechs-only,
// and surface through the player-facing readouts.

describe("call signs — the main effort you serve", () => {
  it("mechs get deterministic call signs; support units don't", () => {
    const a = createGame(MAP01, 7);
    const b = createGame(MAP01, 7);
    const mechA = a.units.find((u) => unitType(u.typeId).cls === "mech")!;
    const mechB = b.units.find((u) => unitType(u.typeId).cls === "mech")!;
    expect(mechA.callSign).toBeTruthy();
    expect(mechA.callSign).toBe(mechB.callSign); // deterministic
    expect(unitLabel(mechA)).toBe(mechA.callSign);

    const recon = a.units.find((u) => unitType(u.typeId).cls === "recon")!;
    expect(recon.callSign).toBeUndefined();
    expect(unitLabel(recon)).toBe(unitType(recon.typeId).name); // falls back to the type
  });

  it("the call sign flows into the cards and the commander-needs readout", () => {
    const s = openGame({
      objective: { kind: "seize", turnLimit: 10, zone: [axial(14, 2)], attacker: "blue" },
      units: [place("mech_assault", "blue", axial(2, 2)), place("infantry", "red", axial(14, 2), 3)],
    });
    beginTurn(s);
    const mech = find(s, "mech_assault");
    expect(mech.callSign).toBeTruthy();

    const card = cardModel(s, mech);
    expect(card.name).toBe(mech.callSign);
    expect(card.subtitle).toBe("Assault Mech"); // type kept as a subtitle

    mech.ammo = mech.ammo.map(() => 0);
    const needs = commanderNeeds(s, "blue");
    expect(needs.some((n) => n.text.startsWith(mech.callSign!))).toBe(true); // speaks by name
  });
});

describe("terrain-aware voice", () => {
  it("a mech holding commanding ground on the objective reports the high ground", () => {
    // The objective sits ON the height, so the seize pull keeps the mech there;
    // with a lower enemy in sight, the high-ground voice triggers.
    const objHex = axial(6, 2);
    const s = openGame({
      w: 14,
      objective: { kind: "seize", turnLimit: 12, zone: [objHex], attacker: "blue" },
      units: [place("mech_assault", "blue", objHex, 0, "ai"), place("infantry", "red", axial(8, 2), 3, "ai")],
    });
    Object.assign(s.cells.get(hexKey(objHex))!, { elevation: 4 }); // commanding ground
    beginTurn(s);
    s.phase = "maneuver";
    const mech = find(s, "mech_assault");
    const decision = decideUnit(s, mech, planForce(s, "blue").tasks.get(mech.id));
    expect(hexKey(decision.destination)).toBe(hexKey(objHex)); // holds the height
    expect(/ridge|high ground|overwatch/i.test(decision.intent)).toBe(true);
  });
});
