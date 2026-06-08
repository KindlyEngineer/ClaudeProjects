import { describe, it, expect } from "vitest";
import { leastDefendedZoneHex, planForce } from "../src/sim/plan";
import { createGame } from "../src/sim/state";
import { updateBelief } from "../src/sim/knowledge";
import { hexKey } from "../src/sim/hex";
import type { ObjectiveDef } from "../src/data/types";
import { MAP01 } from "../src/data/maps/map01";
import { axial, openGame, place } from "./helpers";

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

  it("tasks the attacker's AI units to develop/assault the objective", () => {
    const s = createGame(MAP01, 3);
    // In MAP01 only the blue mech is AI (support is player-run), so it gets a
    // maneuver task; an all-AI side would also see recon probe + screens advance.
    const tasks = [...planForce(s, "blue").tasks.values()];
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.every((t) => t.kind === "advance" || t.kind === "probe")).toBe(true);
  });

  it("picks the least-defended zone hex as the axis (adaptive to what it perceives)", () => {
    const zone = [axial(6, 3), axial(12, 3)]; // far apart
    const objective: ObjectiveDef = { kind: "seize", turnLimit: 10, zone, attacker: "blue" };
    const s = openGame({
      w: 16,
      h: 7,
      objective,
      units: [place("recon", "blue", axial(8, 3)), place("infantry", "red", axial(6, 3), 3)],
    });
    updateBelief(s, "blue"); // blue sees the defender covering the (6,3) hex
    expect(leastDefendedZoneHex(s, "blue")).toEqual(axial(12, 3)); // maneuver to the open one
  });
});
