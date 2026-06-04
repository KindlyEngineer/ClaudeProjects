import { describe, it, expect } from "vitest";
import { planForce } from "../src/sim/plan";
import { createGame } from "../src/sim/state";
import { hexKey } from "../src/sim/hex";
import { MAP01 } from "../src/data/maps/map01";

// Layout signature: the multiset of (goal hex, task kind) a side's plan produces.
function defenderLayout(seed: number): string {
  const s = createGame(MAP01, seed);
  return [...planForce(s, "red").tasks.values()]
    .map((t) => `${hexKey(t.goalHex)}:${t.kind}`)
    .sort()
    .join("|");
}

describe("force planning (AI-3a)", () => {
  it("is deterministic for a seed", () => {
    const s = createGame(MAP01, 5);
    expect(planForce(s, "red")).toEqual(planForce(s, "red"));
  });

  it("varies the defence across seeds (not a rote pattern)", () => {
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) layouts.add(defenderLayout(seed));
    expect(layouts.size).toBeGreaterThan(1); // different seeds → different setups
  });

  it("spreads the defenders into prepared positions, not all on the point", () => {
    const s = createGame(MAP01, 3);
    const plan = planForce(s, "red");
    const goals = new Set([...plan.tasks.values()].map((t) => hexKey(t.goalHex)));
    expect(plan.tasks.size).toBeGreaterThanOrEqual(4); // every red unit is tasked
    expect(goals.size).toBeGreaterThanOrEqual(3); // and dispersed to distinct positions
    expect([...plan.tasks.values()].some((t) => t.kind === "rear")).toBe(true); // supply held back
  });

  it("leaves the attacker objective-seeking (no imposed positions)", () => {
    const s = createGame(MAP01, 3);
    expect(planForce(s, "blue").tasks.size).toBe(0);
  });
});
