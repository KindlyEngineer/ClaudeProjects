import { describe, it, expect } from "vitest";
import { createGame, livingUnits } from "../src/sim/state";
import { attackerHoldsZone } from "../src/sim/objective";
import { noSupport, playerSupport, runMatch } from "../src/sim/match";
import { MAP01 } from "../src/data/maps/map01";

// THE CORE HYPOTHESIS (brief §4, criterion 1): a player controlling only support
// and logistics can change the outcome of a battle fought by autonomous mechs.
// A fixed seeded scenario must fail with no support and succeed with it, the
// delta attributable to player action alone (same seed, same map, same enemy,
// same commander — only the blue support policy differs).

const SEED = 4;

describe("core proof — support changes the outcome", () => {
  it("unsupported mechs FAIL the Seize; the SAME battle SUCCEEDS with support", () => {
    const unsupported = createGame(MAP01, SEED);
    const a = runMatch(unsupported, noSupport);
    expect(a.outcome).toBe("red"); // the mechs run dry / are stopped short
    expect(attackerHoldsZone(unsupported)).toBe(false);

    const supported = createGame(MAP01, SEED);
    const b = runMatch(supported, playerSupport);
    expect(b.outcome).toBe("blue"); // resupply + suppressive fire + recon get it there
    expect(attackerHoldsZone(supported)).toBe(true);

    // The delta is attributable to player action: identical seed/map/enemy.
    expect(a.outcome).not.toBe(b.outcome);
  });

  it("is deterministic — same seed + same support → same result", () => {
    const x = createGame(MAP01, SEED);
    const y = createGame(MAP01, SEED);
    const rx = runMatch(x, playerSupport);
    const ry = runMatch(y, playerSupport);
    expect(rx).toEqual(ry);
  });

  it("every match terminates decisively within the turn cap, supply never negative", () => {
    for (const policy of [noSupport, playerSupport]) {
      const s = createGame(MAP01, SEED);
      const r = runMatch(s, policy);
      expect(["blue", "red"]).toContain(r.outcome); // never hangs as "ongoing"
      expect(r.turns).toBeLessThanOrEqual(s.objective.turnLimit + 1);
      for (const u of livingUnits(s)) {
        expect(u.supply).toBeGreaterThanOrEqual(0);
        expect(u.fuel).toBeGreaterThanOrEqual(0);
        expect(Math.min(0, ...u.ammo)).toBe(0);
      }
    }
  });

  it("the support advantage is broad, not a lucky seed (sample of seeds)", () => {
    // The defender is a varied, competent AI, so it sometimes holds even a
    // supported attack — but the delta is decisive: unaided it never loses.
    let noWins = 0;
    let withWins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      if (runMatch(createGame(MAP01, seed), noSupport).outcome === "blue") noWins++;
      if (runMatch(createGame(MAP01, seed), playerSupport).outcome === "blue") withWins++;
    }
    expect(noWins).toBe(0); // the mechs never seize unaided
    expect(withWins).toBeGreaterThanOrEqual(12); // and usually do with support
  });
});
