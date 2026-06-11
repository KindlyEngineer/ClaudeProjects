import { describe, it, expect } from "vitest";
import { decideUnit } from "../src/sim/ai";
import { commanderNeeds } from "../src/sim/needs";
import { moveCostAt } from "../src/sim/effects";
import { canSee, weatherVision } from "../src/sim/vision";
import { createGame, livingUnits } from "../src/sim/state";
import { noSupport, runMatch } from "../src/sim/match";
import { beginTurn } from "../src/sim/turn";
import { temperamentOf } from "../src/data/temperaments";
import { hexDistance } from "../src/sim/hex";
import { MAP06 } from "../src/data/maps/map06";
import { axial, find, openGame, place } from "./helpers";

// M3 — Character: per-call-sign temperaments (the same machine plays and talks
// differently under a different name) and weather as a battle-wide condition
// on the shared queries (the AI adapts because everyone asks the same
// questions). All deterministic.

describe("temperaments — the name is the personality", () => {
  it("Saber (bold) ends closer to the enemy than Vanguard (methodical) in a mirrored fight", () => {
    // Two identical mechs, mirrored rows, one enemy dead-centre between them.
    // Placement order fixes the names: #1 Vanguard (methodical), #2 Saber (bold).
    const s = openGame({
      w: 16,
      h: 9,
      objective: { kind: "seize", turnLimit: 12, zone: [axial(14, 4)], attacker: "blue" },
      units: [
        place("mech_assault", "blue", axial(2, 2), 0, "ai"), // Vanguard
        place("mech_assault", "blue", axial(2, 6), 0, "ai"), // Saber
        place("armor", "red", axial(8, 4), 3, "ai"),
      ],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const [vanguard, saber] = livingUnits(s, "blue");
    expect(vanguard.callSign).toBe("Vanguard");
    expect(saber.callSign).toBe("Saber");
    const enemy = find(s, "armor", "red");

    const dv = decideUnit(s, vanguard);
    const ds = decideUnit(s, saber);
    // Bold discounts exposure and leans in; methodical pays for margins.
    expect(hexDistance(ds.destination, enemy.hex)).toBeLessThanOrEqual(hexDistance(dv.destination, enemy.hex));
  });

  it("the voices differ — and the resupply reason always ships", () => {
    expect(temperamentOf("Saber")!.voice.advance).not.toBe(temperamentOf("Vanguard")!.voice.advance);

    const s = openGame({
      w: 18,
      objective: { kind: "seize", turnLimit: 12, zone: [axial(16, 2)], attacker: "blue" },
      units: [place("mech_assault", "blue", axial(2, 2), 0, "ai"), place("supply", "blue", axial(1, 2), 0, "ai"), place("armor", "red", axial(16, 2), 3, "ai")],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const mech = find(s, "mech_assault");
    mech.ammo = mech.ammo.map(() => 0); // bone dry → it must break contact
    const d = decideUnit(s, mech);
    expect(d.stance).toBe("resupply");
    expect(d.intent).toContain("(low ammo)"); // legibility survives the flavour
  });

  it("during deployment, the commanders speak in their own voices", () => {
    const s = openGame({
      units: [place("mech_assault", "blue", axial(2, 2), 0, "ai"), place("mech_scout", "blue", axial(2, 4), 0, "ai"), place("armor", "red", axial(9, 2), 3, "ai")],
    });
    s.deployPending = true;
    const lines = commanderNeeds(s, "blue");
    expect(lines.length).toBe(2);
    expect(lines[0].text).toContain("Vanguard (Methodical)");
    expect(lines[0].text).toContain(temperamentOf("Vanguard")!.voice.deploy);
    expect(lines[1].text).toContain("Saber (Bold)");
  });
});

describe("weather — the sky is a rule", () => {
  it("night halves sight; rain trims it", () => {
    const s = openGame({ w: 20, units: [place("recon", "blue", axial(2, 2)), place("infantry", "red", axial(12, 2), 3)] });
    const recon = find(s, "recon"); // vision 12
    const enemy = find(s, "infantry", "red"); // 10 hexes out
    expect(canSee(s, recon, enemy.hex)).toBe(true); // clear: 12 ≥ 10

    s.weather = "night";
    expect(weatherVision(s, 12)).toBe(6);
    expect(canSee(s, recon, enemy.hex)).toBe(false); // the dark eats the line

    s.weather = "rain";
    expect(weatherVision(s, 12)).toBe(10);
    expect(canSee(s, recon, enemy.hex)).toBe(true); // 10 ≥ 10, just barely
  });

  it("rain turns soft ground to mud — roads stay firm", () => {
    const s = openGame({
      units: [place("armor", "blue", axial(1, 2))],
      terrain: [{ hex: axial(3, 2), terrain: "road" }],
    });
    const open0 = moveCostAt(s, axial(2, 2));
    const road0 = moveCostAt(s, axial(3, 2));
    s.weather = "rain";
    expect(moveCostAt(s, axial(2, 2))).toBeGreaterThan(open0); // mud
    expect(moveCostAt(s, axial(3, 2))).toBe(road0); // pavement doesn't care
  });

  it("the night battle (Rearguard) terminates soundly under full-AI play", () => {
    const allAi = { ...MAP06, units: MAP06.units.map((u) => ({ ...u, controller: "ai" as const })) };
    for (const seed of [1, 2, 3]) {
      const s = createGame(allAi, seed);
      expect(s.weather).toBe("night");
      const r = runMatch(s, noSupport);
      expect(["blue", "red"]).toContain(r.outcome);
      for (const u of livingUnits(s)) {
        expect(u.fuel).toBeGreaterThanOrEqual(0);
        expect(Math.min(0, ...u.ammo)).toBe(0);
      }
    }
  });
});
