import { describe, it, expect } from "vitest";
import { commanderNeeds } from "../src/sim/needs";
import { axial, find, openGame, place } from "./helpers";

// The COMMS surface (owner UX ruling): dialogue lives in a dedicated column
// outside the play area, formatted Speaker — Content. The sim side of that is
// structure: every commander need carries WHO is speaking and WHAT they said,
// separately from the assembled one-line `text` the snapshot panel shows.

const battlefield = () =>
  openGame({
    units: [place("mech_assault", "blue", axial(2, 2), 0, "ai"), place("armor", "red", axial(9, 2), 3, "ai")],
  });

describe("needs carry speaker + content", () => {
  it("per-mech traffic speaks under its call sign; the text stays assembled", () => {
    const s = battlefield();
    const mech = find(s, "mech_assault");
    mech.inSupply = false;
    const lines = commanderNeeds(s, "blue");
    const cutOff = lines.find((n) => n.content.includes("CUT OFF"))!;
    expect(cutOff.speaker).toBe("Vanguard");
    expect(cutOff.content).not.toContain("Vanguard"); // content stands alone
    expect(cutOff.text).toContain("Vanguard"); // the one-liner still reads whole
  });

  it("force-level traffic comes from COMMAND", () => {
    const s = battlefield();
    const lines = commanderNeeds(s, "blue");
    const force = lines.find((n) => n.speaker === "COMMAND")!;
    expect(force).toBeDefined();
    expect(force.text).toBe(force.content); // no name to prepend
  });

  it("deployment quotes carry the tagged speaker and the quoted voice", () => {
    const s = battlefield();
    s.deployPending = true;
    const [q] = commanderNeeds(s, "blue");
    expect(q.speaker).toContain("Vanguard (Methodical");
    expect(q.content.startsWith('"')).toBe(true); // their words, quoted
    expect(q.text).toBe(`${q.speaker}: ${q.content}`);
  });
});
