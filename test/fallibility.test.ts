import { describe, it, expect } from "vitest";
import { decideUnit } from "../src/sim/ai";
import { hexKey } from "../src/sim/hex";
import type { ObjectiveDef } from "../src/data/types";
import { axial, find, openGame, place } from "./helpers";

// Commanders aren't perfect — but their imperfection is SEEDED and BOUNDED: a
// misstep, never a blunder, and reproducible. (Skill 1 = always optimal, which
// is what every other unit test relies on by default.)

const objective: ObjectiveDef = { kind: "seize", turnLimit: 20, zone: [axial(20, 4)], attacker: "blue" };
const game = () => openGame({ w: 26, h: 9, objective, units: [place("mech_assault", "blue", axial(6, 4))] });

describe("commander fallibility", () => {
  it("is deterministic even when fallible (same seed → same decision)", () => {
    const a = game();
    const b = game();
    a.skill.blue = 0.5;
    b.skill.blue = 0.5;
    expect(decideUnit(a, find(a, "mech_assault"))).toEqual(decideUnit(b, find(b, "mech_assault")));
  });

  it("a fallible commander sometimes missteps — but not every time (bounded)", () => {
    const s = game();
    const mech = find(s, "mech_assault");
    s.skill.blue = 1; // flawless → the optimal move
    const optimal = hexKey(decideUnit(s, mech).destination);

    s.skill.blue = 0.5; // fallible
    let missteps = 0;
    for (let t = 1; t <= 30; t++) {
      s.turn = t; // varies the seeded judgement
      if (hexKey(decideUnit(s, mech).destination) !== optimal) missteps++;
    }
    expect(missteps).toBeGreaterThan(0); // it does err...
    expect(missteps).toBeLessThan(30); // ...but usually still plays near-best
  });

  it("at skill 1 it is exactly optimal (the default every test relies on)", () => {
    const s = game();
    const mech = find(s, "mech_assault");
    s.skill.blue = 1;
    const first = decideUnit(s, mech).destination;
    for (let t = 1; t <= 10; t++) {
      s.turn = t;
      expect(decideUnit(s, mech).destination).toEqual(first); // no seeded wobble when flawless
    }
  });
});
