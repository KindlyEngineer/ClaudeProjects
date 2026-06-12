import { describe, it, expect } from "vitest";
import { buySupport, createOperation, finishInterlude, interludeBrief, prepareBattle, recordBattle } from "../src/sim/operation";
import { unitType } from "../src/data/units";

// The player's call sign (owner addition): the relationship runs BOTH ways —
// the mechs have names, temperaments and trust; the player has a name the
// commanders use. The sim side is `interludeBrief`: pure, deterministic, the
// name is a PARAMETER (the sim never reads settings), state-aware in priority
// order — the dead outrank the depot, the depot outranks comfort.

const fresh = () => createOperation("op01", 7);

describe("the commander's Interlude word", () => {
  it("a fresh, healthy operation gets the readiness line, addressed by name", () => {
    const b = interludeBrief(fresh(), "Andrew");
    expect(b.speaker).toBe("Vanguard"); // the senior surviving mech speaks
    expect(b.text.startsWith("Andrew, ")).toBe(true);
    expect(b.text).toContain("the force is ready");
    expect(b.text).toContain("Battle I"); // it names where you're going
  });

  it("a thin depot asks the resupply question — the owner's exact scenario", () => {
    const op = fresh();
    op.stockpile = { ...op.stockpile, ammo: 4, fuel: 10, repair: 3 };
    const b = interludeBrief(op, "Andrew");
    expect(b.text).toContain("Andrew, supplies are thin");
    expect(b.text).toContain("resupply");
  });

  it("the dead outrank the depot: a lost name leads, whatever the stockpile", () => {
    const op = fresh();
    buySupport(op, "supply");
    finishInterlude(op);
    const state = prepareBattle(op);
    const mech = state.units.find((u) => u.callSign && u.side === "blue")!;
    const fallen = mech.callSign!;
    mech.structure = 0;
    state.outcome = "red";
    recordBattle(op, state);
    op.stockpile = { ...op.stockpile, ammo: 0, fuel: 0, repair: 0 }; // thin AND bereaved

    // The op continues only if another mech lives — requisition keeps it alive
    // in real play; here the brief itself is what's under test.
    const b = interludeBrief(op, "Andrew");
    expect(b.text).toContain(`we buried ${fallen}`);
    expect(b.text).not.toContain("supplies are thin"); // grief first
    expect(b.speaker).not.toBe(fallen); // the dead don't speak
  });

  it("unnamed players get the same line, undirected and properly capitalized", () => {
    const op = fresh();
    op.stockpile = { ...op.stockpile, ammo: 4, fuel: 10, repair: 3 };
    for (const empty of [undefined, "", "   "]) {
      const b = interludeBrief(op, empty);
      expect(b.text.startsWith("Supplies are thin")).toBe(true); // no orphaned comma
      expect(b.text).not.toContain("undefined");
    }
  });

  it("hurt-but-stocked mechs talk about the refit, not the depot", () => {
    const op = fresh();
    const mech = op.roster.find((r) => unitType(r.typeId).cls === "mech")!;
    mech.structure = 5; // mauled, depot still full
    const b = interludeBrief(op, "Andrew");
    expect(b.text).toContain("took a beating");
  });
});
