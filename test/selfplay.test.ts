import { describe, it, expect } from "vitest";
import { createGame, livingUnits } from "../src/sim/state";
import { noSupport, runMatch } from "../src/sim/match";
import { MAP01 } from "../src/data/maps/map01";

// AI-vs-AI self-play: every unit on BOTH sides is AI-commanded (the force AI runs
// all roles). The brief's primary balance/termination/invariant harness — and a
// soundness net: matches must always terminate decisively without violating
// logistics or running resources negative.

function allAiGame(seed: number) {
  const map = { ...MAP01, units: MAP01.units.map((u) => ({ ...u, controller: "ai" as const })) };
  return createGame(map, seed);
}

describe("AI-vs-AI self-play", () => {
  it("terminates decisively and soundly across seeds (both sides fully AI)", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = allAiGame(seed);
      const r = runMatch(s, noSupport);
      expect(["blue", "red"]).toContain(r.outcome); // never hangs
      expect(r.turns).toBeLessThanOrEqual(s.objective.turnLimit + 1);
      for (const u of livingUnits(s)) {
        expect(u.supply).toBeGreaterThanOrEqual(0);
        expect(u.fuel).toBeGreaterThanOrEqual(0);
        expect(Math.min(0, ...u.ammo)).toBe(0);
      }
    }
  });
});
