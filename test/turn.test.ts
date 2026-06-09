import { describe, it, expect } from "vitest";
import { beginTurn, homePhase, isEligible, nextPhase, PHASES } from "../src/sim/turn";
import { axial, find, openGame, place } from "./helpers";

describe("phased initiative", () => {
  const game = () =>
    openGame({
      units: [
        place("recon", "blue", axial(1, 1)),
        place("artillery", "blue", axial(1, 2)),
        place("armor", "blue", axial(1, 3)),
      ],
    });

  it("runs recon → fires → maneuver, then rolls into the next turn", () => {
    const s = game();
    beginTurn(s);
    expect(s.phase).toBe("recon");
    expect(nextPhase(s)).toBe(false);
    expect(s.phase).toBe("fires");
    expect(nextPhase(s)).toBe(false);
    expect(s.phase).toBe("maneuver");
    const turnBefore = s.turn;
    expect(nextPhase(s)).toBe(true); // new turn
    expect(s.turn).toBe(turnBefore + 1);
    expect(s.phase).toBe("recon");
  });

  it("each class acts in its home phase", () => {
    expect(homePhase(find(game(), "recon"))).toBe("recon");
    expect(homePhase(find(game(), "artillery"))).toBe("fires");
    expect(homePhase(find(game(), "armor"))).toBe("maneuver");
  });

  it("a unit is only eligible in its home phase", () => {
    const s = game();
    const recon = find(s, "recon");
    const armor = find(s, "armor");
    s.phase = "recon";
    expect(isEligible(s, recon)).toBe(true);
    expect(isEligible(s, armor)).toBe(false);
    s.phase = "maneuver";
    expect(isEligible(s, recon)).toBe(false);
    expect(isEligible(s, armor)).toBe(true);
  });

  it("a reserved unit skips its home phase and commits in maneuver", () => {
    const s = game();
    const recon = find(s, "recon");
    recon.reserved = true;
    s.phase = "recon";
    expect(isEligible(s, recon)).toBe(false);
    s.phase = "maneuver";
    expect(isEligible(s, recon)).toBe(true);
  });

  it("upkeep resets activation and decays suppression (recovering shaken crews)", () => {
    const s = game();
    const u = find(s, "armor");
    u.movedThisTurn = true;
    u.actedThisTurn = true;
    u.suppression = 9;
    u.crits.push("shaken");
    beginTurn(s);
    expect(u.movedThisTurn).toBe(false);
    expect(u.actedThisTurn).toBe(false);
    expect(u.suppression).toBeLessThan(9);
    expect(u.crits).not.toContain("shaken"); // recovered below the break
  });

  it("a reserve commitment lasts one turn (cleared by upkeep)", () => {
    const s = game();
    const recon = find(s, "recon");
    recon.reserved = true;
    beginTurn(s);
    expect(recon.reserved).toBe(false); // back to its home phase next turn
  });

  it("upkeep clears intents of destroyed units (no banners for the dead)", () => {
    const s = game();
    const armor = find(s, "armor");
    s.intents[armor.id] = "Advancing";
    armor.structure = 0;
    beginTurn(s);
    expect(s.intents[armor.id]).toBeUndefined();
  });

  it("PHASES is the canonical order", () => {
    expect([...PHASES]).toEqual(["recon", "fires", "maneuver"]);
  });
});
