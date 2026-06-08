import { describe, it, expect } from "vitest";
import { commandForce } from "../src/sim/ai";
import { evaluateOutcome } from "../src/sim/objective";
import { beginTurn, nextPhase } from "../src/sim/turn";
import { unitType } from "../src/data/units";
import type { ObjectiveDef, Side } from "../src/data/types";
import type { GameState } from "../src/sim/state";
import { axial, openGame, place } from "./helpers";

function blueMech(s: GameState) {
  return s.units.find((u) => u.side === "blue" && unitType(u.typeId).cls === "mech" && u.structure > 0);
}
function mech(s: GameState, side: Side) {
  return s.units.find((u) => u.side === side && unitType(u.typeId).cls === "mech" && u.structure > 0);
}

describe("Breakthrough objective", () => {
  it("the attacker wins by reaching the far-edge exit", () => {
    const exit = axial(11, 2);
    const objective: ObjectiveDef = { kind: "breakthrough", turnLimit: 10, zone: [exit], attacker: "blue" };
    const s = openGame({ w: 14, h: 5, objective, units: [place("mech_assault", "blue", exit)] });
    expect(evaluateOutcome(s)).toBe("blue"); // a mech on the exit = through
  });
});

describe("objective expressiveness (Seize vs Breakthrough — same map/seed)", () => {
  it("Breakthrough drives for the exit; Seize develops and holds short", () => {
    const zone = [axial(16, 2)]; // SAME goal hex for both → isolates the objective KIND
    const make = (kind: "seize" | "breakthrough") =>
      openGame({
        w: 22,
        h: 5,
        seed: 1,
        objective: { kind, turnLimit: 16, zone, attacker: "blue" },
        units: [place("mech_assault", "blue", axial(1, 2)), place("mech_assault", "red", axial(13, 2), 3)],
      });
    const maxAdvance = (kind: "seize" | "breakthrough") => {
      const s = make(kind);
      beginTurn(s);
      let mx = -Infinity;
      for (let i = 0; i < 7 * 3; i++) {
        commandForce(s, "blue");
        commandForce(s, "red");
        const m = blueMech(s);
        if (m) mx = Math.max(mx, m.hex.q);
        nextPhase(s);
      }
      return mx;
    };
    // Seize holds at a support bound (it never gets fire superiority on the
    // unsuppressed defender); Breakthrough pushes past it toward the exit.
    expect(maxAdvance("breakthrough")).toBeGreaterThan(maxAdvance("seize"));
  });
});

describe("the mirror — the AI attacks as red", () => {
  it("red (the attacker) drives toward its objective", () => {
    const objective: ObjectiveDef = { kind: "seize", turnLimit: 16, zone: [axial(1, 2)], attacker: "red" };
    const s = openGame({
      w: 18,
      h: 5,
      seed: 1,
      objective,
      units: [place("mech_assault", "red", axial(16, 2), 3), place("armor", "blue", axial(2, 2))],
    });
    const red = mech(s, "red")!;
    const startQ = red.hex.q;
    beginTurn(s);
    for (let i = 0; i < 6 * 3; i++) {
      commandForce(s, "blue");
      commandForce(s, "red");
      nextPhase(s);
    }
    const now = mech(s, "red");
    expect(now && now.hex.q).toBeLessThan(startQ); // advanced WEST toward its objective
    expect(evaluateOutcome(s)).not.toBe("blue"); // blue (defender) hasn't somehow "won"
  });
});
