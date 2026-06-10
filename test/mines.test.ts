import { describe, it, expect } from "vitest";
import { canLayMines, clearMinefield, layMinefield, moveUnit } from "../src/sim/actions";
import { commandForce } from "../src/sim/ai";
import { addEffect, hasEffect, hostileMinefieldAt } from "../src/sim/effects";
import { hexKey } from "../src/sim/hex";
import { reachable } from "../src/sim/pathing";
import { beginTurn, nextPhase } from "../src/sim/turn";
import { axial, find, openGame, place } from "./helpers";

// Minefields (M2): engineer-laid, owner-safe, single-use triggers. Known fields
// are routed around (pathing); unknown ones detonate mid-move and stop it.

describe("mine detonation", () => {
  it("a hostile mine stops the move, damages, can kill mobility, and is consumed", () => {
    const s = openGame({ units: [place("armor", "blue", axial(1, 2), 0)] });
    addEffect(s, "minefield", axial(3, 2), "red"); // an unseen red field on the route
    beginTurn(s);
    s.phase = "maneuver";
    const tank = find(s, "armor");
    const str0 = tank.structure;
    const r = moveUnit(s, tank, [axial(2, 2), axial(3, 2), axial(4, 2)]);
    expect(r.moved).toBe(true);
    expect(r.mineStruck).toBe(true);
    expect(tank.hex).toEqual(axial(3, 2)); // stopped ON the strike hex, short of the goal
    expect(r.cost).toBe(2); // paid only for ground covered
    expect(tank.structure).toBe(str0 - 6); // side armour 4 < pen 7 → full damage
    expect(hasEffect(s, axial(3, 2), "minefield")).toBe(false); // single-use
    expect(s.events.some((e) => e.kind === "mine")).toBe(true);
  });

  it("your own minefield is marked and safe", () => {
    const s = openGame({ units: [place("armor", "blue", axial(1, 2), 0)] });
    addEffect(s, "minefield", axial(2, 2), "blue");
    beginTurn(s);
    s.phase = "maneuver";
    const tank = find(s, "armor");
    const r = moveUnit(s, tank, [axial(2, 2)]);
    expect(r.mineStruck).toBeFalsy();
    expect(hasEffect(s, axial(2, 2), "minefield")).toBe(true); // still armed for RED
  });

  it("pathing routes around KNOWN hostile fields, not unknown ones", () => {
    const s = openGame({
      w: 14,
      units: [place("armor", "blue", axial(2, 2), 0), place("recon", "blue", axial(3, 2), 0)],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const tank = find(s, "armor");
    const mined = axial(4, 2); // adjacent-ish, in plain sight of the recon
    addEffect(s, "minefield", mined, "red");
    expect(reachable(s, tank).has(hexKey(mined))).toBe(false); // seen → avoided

    // The same field deep in the fog is NOT avoided (nobody knows it's there).
    const s2 = openGame({ w: 30, units: [place("armor", "blue", axial(2, 2), 0)] });
    beginTurn(s2);
    s2.phase = "maneuver";
    const farMine = axial(6, 2); // distance 4 > the blinded vision of 3, within move 6
    // Strip vision: the tank alone (vision 7) DOES see (5,2)... so verify the
    // contrast with an unscouted hex instead: blind the tank with a sensors hit.
    find(s2, "armor").crits.push("sensors"); // vision 7 → 3
    addEffect(s2, "minefield", farMine, "red");
    expect(reachable(s2, find(s2, "armor")).has(hexKey(farMine))).toBe(true); // unseen → enterable
  });
});

describe("engineer mine verbs", () => {
  it("lays owner-safe fields (adjacency, no stacking) and breaches hostile ones", () => {
    const s = openGame({ units: [place("engineer", "blue", axial(3, 2), 0)] });
    beginTurn(s);
    s.phase = "maneuver";
    const eng = find(s, "engineer");
    expect(layMinefield(s, eng, axial(4, 2)).ok).toBe(true);
    expect(hasEffect(s, axial(4, 2), "minefield")).toBe(true);
    expect(eng.actedThisTurn).toBe(true);
    expect(canLayMines(s, eng, axial(4, 2)).reason).toBe("already acted");
    eng.actedThisTurn = false;
    expect(canLayMines(s, eng, axial(4, 2)).reason).toBe("already mined");
    expect(canLayMines(s, eng, axial(6, 2)).reason).toBe("not adjacent");

    // A red field next door: breach it.
    addEffect(s, "minefield", axial(2, 2), "red");
    expect(clearMinefield(s, eng, axial(2, 2)).ok).toBe(true);
    expect(hostileMinefieldAt(s, "blue", axial(2, 2))).toBeUndefined();
  });

  it("a DEFENDING AI engineer mines the approach once dug in", () => {
    const s = openGame({
      objective: { kind: "seize", turnLimit: 10, zone: [axial(4, 2)], attacker: "red" }, // blue defends
      units: [place("engineer", "blue", axial(4, 2)), place("mech_assault", "red", axial(10, 2), 3)],
    });
    beginTurn(s);
    nextPhase(s);
    nextPhase(s); // maneuver
    commandForce(s, "blue"); // turn 1: fortifies its hex
    s.turn += 1;
    beginTurn(s);
    nextPhase(s);
    nextPhase(s);
    commandForce(s, "blue"); // turn 2: lays the field on the approach
    expect(s.events.some((e) => e.kind === "build" && e.effect === "minefield")).toBe(true);
    const field = s.effects.find((e) => e.kind === "minefield");
    expect(field?.side).toBe("blue");
  });
});
