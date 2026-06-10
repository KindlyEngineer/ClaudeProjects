import { describe, it, expect } from "vitest";
import { createGame, livingUnits } from "../src/sim/state";
import { noSupport, runMatch } from "../src/sim/match";
import type { MapDef } from "../src/data/types";
import { MAP04 } from "../src/data/maps/map04";
import { MAP05 } from "../src/data/maps/map05";
import { randomSkirmishMap } from "../src/data/maps/gen";

// The M2 scenario set: every new battlefield must be SOUND under full-AI play —
// decisive termination, no invariant breaches — including the first DEFENSE
// (red attacks, blue holds: endstate ruling D2) and the seeded random skirmish.

function allAi(map: MapDef): MapDef {
  return { ...map, units: map.units.map((u) => ({ ...u, controller: "ai" as const })) };
}

function sweep(map: MapDef, seeds: number): { attackerWins: number } {
  let attackerWins = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const s = createGame(allAi(map), seed);
    const r = runMatch(s, noSupport);
    expect(["blue", "red"]).toContain(r.outcome);
    expect(r.turns).toBeLessThanOrEqual(s.objective.turnLimit + 1);
    for (const u of livingUnits(s)) {
      expect(u.supply).toBeGreaterThanOrEqual(0);
      expect(u.fuel).toBeGreaterThanOrEqual(0);
      expect(Math.min(0, ...u.ammo)).toBe(0);
    }
    if (r.outcome === map.objective.attacker) attackerWins++;
  }
  return { attackerWins };
}

describe("M2 scenarios — sound under full-AI play", () => {
  it("Watchline (the defense — RED attacks, blue holds) terminates soundly", () => {
    const N = 8;
    const { attackerWins } = sweep(MAP04, N);
    // The unaided defence should hold more often than not — the PLAYER's
    // engineering and fires are what's meant to make it stick.
    expect(attackerWins).toBeLessThan(N);
  });

  it("Causeway (the smoke lesson) terminates soundly", () => {
    sweep(MAP05, 8);
  });

  it("the random skirmish generator yields sound, deterministic battlefields", () => {
    // Determinism: the same seed builds the same map.
    const a = randomSkirmishMap(7);
    const b = randomSkirmishMap(7);
    expect(a.cells).toEqual(b.cells);
    expect(a.units).toEqual(b.units);
    // Different seeds vary the ground.
    const c = randomSkirmishMap(8);
    expect(JSON.stringify(c.cells)).not.toBe(JSON.stringify(a.cells));
    // And several generated boards play out soundly.
    for (const seed of [3, 11, 27]) sweep(randomSkirmishMap(seed), 3);
  });
});
