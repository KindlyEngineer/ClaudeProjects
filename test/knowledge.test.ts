import { describe, it, expect } from "vitest";
import { believedEnemies, updateBelief, visibleSightings } from "../src/sim/knowledge";
import { createGame } from "../src/sim/state";
import { unitType } from "../src/data/units";
import { RULES } from "../src/data/rules";
import { MAP01 } from "../src/data/maps/map01";
import { axial, find, openGame, place } from "./helpers";

describe("fog-limited knowledge (belief)", () => {
  it("knows a currently-visible enemy, then REMEMBERS its last-known spot after losing sight", () => {
    const s = openGame({
      w: 26,
      h: 7,
      units: [place("recon", "blue", axial(2, 3)), place("armor", "red", axial(6, 3))],
    });
    const red = find(s, "armor", "red");
    const lastKnown = { ...red.hex };

    updateBelief(s, "blue");
    const fresh = s.belief.blue.get(red.id)!;
    expect(fresh.visibleNow).toBe(true);
    expect(fresh.hex).toEqual(lastKnown);

    // The enemy slips far out of the recon's sight.
    red.hex = axial(22, 3);
    s.turn = 2;
    updateBelief(s, "blue");
    const remembered = s.belief.blue.get(red.id)!;
    expect(remembered.visibleNow).toBe(false); // no longer seen
    expect(remembered.hex).toEqual(lastKnown); // but the AI only knows where it WAS

    // It's still believed (for caution) but not a current target.
    expect(believedEnemies(s, "blue")).toHaveLength(1);
    expect(visibleSightings(s, "blue")).toHaveLength(0);
  });

  it("forgets a sighting once it goes stale", () => {
    const s = openGame({
      w: 26,
      h: 7,
      units: [place("recon", "blue", axial(2, 3)), place("armor", "red", axial(6, 3))],
    });
    const red = find(s, "armor", "red");
    updateBelief(s, "blue");
    red.hex = axial(22, 3); // gone from sight
    s.turn = 2 + RULES.commander.memoryTurns + 1;
    updateBelief(s, "blue");
    expect(s.belief.blue.has(red.id)).toBe(false); // forgotten
  });

  it("each side believes only its own enemies", () => {
    const s = openGame({
      w: 26,
      h: 7,
      units: [place("recon", "blue", axial(2, 3)), place("recon", "red", axial(6, 3))],
    });
    updateBelief(s, "blue");
    updateBelief(s, "red");
    expect(believedEnemies(s, "blue")[0]?.side).toBe("red");
    expect(believedEnemies(s, "red")[0]?.side).toBe("blue");
  });
});

describe("controller designation", () => {
  it("the scenario sets AI vs player per unit (mechs AI, blue support player, red all AI)", () => {
    const s = createGame(MAP01, 1);
    for (const u of s.units) {
      if (unitType(u.typeId).cls === "mech") expect(u.controller).toBe("ai");
      else if (u.side === "blue") expect(u.controller).toBe("player");
      else expect(u.controller).toBe("ai");
    }
  });
});
