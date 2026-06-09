import { describe, it, expect } from "vitest";
import { attackUnit, faceUnit, moveUnit, resupplyUnit } from "../src/sim/actions";
import { beginTurn } from "../src/sim/turn";
import { axial, find, openGame, place } from "./helpers";

// The sim's event stream: actions append plain records of WHAT HAPPENED so the
// UI can replay them (animation, combat log) without re-deriving anything. The
// stream is part of state — deterministic, serializable, append-only.

describe("sim event stream", () => {
  it("records moves, turns-in-place, fire and resupply with their outcomes", () => {
    const s = openGame({
      units: [
        place("armor", "blue", axial(1, 2), 0),
        place("supply", "blue", axial(1, 1), 0),
        place("infantry", "red", axial(4, 2), 3),
      ],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const armor = find(s, "armor");
    const supply = find(s, "supply");
    const enemy = find(s, "infantry", "red");

    const n0 = s.events.length;
    moveUnit(s, armor, [axial(2, 2)], 1);
    const mv = s.events[s.events.length - 1];
    expect(mv.kind).toBe("move");
    if (mv.kind === "move") {
      expect(mv.id).toBe(armor.id);
      expect(mv.from).toEqual(axial(1, 2));
      expect(mv.path).toEqual([axial(2, 2)]);
      expect(mv.facing).toBe(1);
    }

    attackUnit(s, armor, 0, enemy);
    const fire = s.events[s.events.length - 1];
    expect(fire.kind).toBe("fire");
    if (fire.kind === "fire") {
      expect(fire.targetId).toBe(enemy.id);
      expect(fire.at).toEqual(axial(4, 2));
      expect(fire.weapon).toBe("120mm Gun");
      expect(typeof fire.hit).toBe("boolean"); // outcome recorded, whatever it was
    }

    armor.fuel = 1; // make the tank needy so the transfer has something to do
    resupplyUnit(s, supply, armor); // (1,1) is adjacent to the tank's new hex
    const sup = s.events[s.events.length - 1];
    expect(sup.kind).toBe("resupply");
    if (sup.kind === "resupply") {
      expect(sup.targetId).toBe(armor.id);
      expect(sup.fuel).toBeGreaterThan(0);
    }

    faceUnit(s, supply, 2);
    const fc = s.events[s.events.length - 1];
    expect(fc.kind).toBe("face");
    if (fc.kind === "face") expect(fc.facing).toBe(2);

    expect(s.events.length).toBeGreaterThan(n0);
    expect(s.events.map((e) => e.seq)).toEqual(s.events.map((_, i) => i)); // dense, ordered
  });

  it("failed actions emit nothing", () => {
    const s = openGame({ units: [place("armor", "blue", axial(1, 2), 0)] });
    beginTurn(s);
    s.phase = "recon"; // wrong phase for armor
    const n = s.events.length;
    moveUnit(s, find(s, "armor"), [axial(2, 2)]);
    faceUnit(s, find(s, "armor"), 2);
    expect(s.events.length).toBe(n);
  });

  it("upkeep marks turns (the combat log's timeline)", () => {
    const s = openGame({ units: [place("armor", "blue", axial(1, 2))] });
    beginTurn(s);
    expect(s.events.some((e) => e.kind === "turn")).toBe(true);
  });
});
