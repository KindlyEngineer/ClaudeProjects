import { describe, it, expect } from "vitest";
import { createGame, livingUnits } from "../src/sim/state";
import { noSupport, runMatch } from "../src/sim/match";
import type { MapDef } from "../src/data/types";
import { MAP01 } from "../src/data/maps/map01";
import { MAP02 } from "../src/data/maps/map02";

// AI-vs-AI self-play (both sides AI) — the brief's primary balance / termination /
// crash / invariant harness, and a soundness net.

function allAi(map: MapDef): MapDef {
  return { ...map, units: map.units.map((u) => ({ ...u, controller: "ai" as const })) };
}

function attackerWins(map: MapDef, seeds: number): number {
  const ai = allAi(map);
  let wins = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const s = createGame(ai, seed);
    const r = runMatch(s, noSupport);
    // Soundness on every match.
    expect(["blue", "red"]).toContain(r.outcome);
    expect(r.turns).toBeLessThanOrEqual(s.objective.turnLimit + 1);
    for (const u of livingUnits(s)) {
      expect(u.supply).toBeGreaterThanOrEqual(0);
      expect(u.fuel).toBeGreaterThanOrEqual(0);
      expect(Math.min(0, ...u.ammo)).toBe(0);
    }
    if (r.outcome === map.objective.attacker) wins++;
  }
  return wins;
}

describe("AI-vs-AI self-play", () => {
  it("terminates decisively and soundly across maps (both sides fully AI)", () => {
    attackerWins(MAP01, 12); // throws on any invariant/termination failure
    attackerWins(MAP02, 12);
  });

  it("the AI competently plays BOTH roles (wins on the attack and on the defence)", () => {
    const N = 16;
    // Given superiority on open ground (Steppe), the AI ATTACK succeeds.
    expect(attackerWins(MAP02, N)).toBeGreaterThan(N / 3);
    // At parity against a prepared defence (Ridge), the AI DEFENCE holds — the
    // attacker rarely breaks through unaided (the player's support is the edge).
    expect(attackerWins(MAP01, N)).toBeLessThan(N / 3);
  });
});
