import { describe, it, expect } from "vitest";
import { decideUnit } from "../src/sim/ai";
import { commanderNeeds } from "../src/sim/needs";
import { emit } from "../src/sim/events";
import { hexDistance } from "../src/sim/hex";
import {
  buySupport,
  commanderRefit,
  createOperation,
  finishInterlude,
  prepareBattle,
  recordBattle,
  requisitionMech,
  trustOf,
  type OperationState,
} from "../src/sim/operation";
import { clampTrust, trustBand } from "../src/sim/trust";
import { createGame, livingUnits } from "../src/sim/state";
import { beginTurn } from "../src/sim/turn";
import { mapById } from "../src/data/operations";
import { RULES } from "../src/data/rules";
import { unitType } from "../src/data/units";
import { axial, find, openGame, place } from "./helpers";

// Horizon 2 — TRUST (ruling D13): the commander's per-call-sign confidence in
// the support, EARNED from what the player actually delivered across the
// operation, never asserted. It bends the same utility weights temperament
// does (WARY hedges, ASSURED commits), it is legible at every surface, and it
// persists through the checkpoint save. Skirmishes carry no history.

describe("trust bands — the number reads as a posture", () => {
  it("maps values to bands; no value means no history (STEADY)", () => {
    expect(trustBand(undefined)).toBe("STEADY");
    expect(trustBand(RULES.trust.waryBelow - 1)).toBe("WARY");
    expect(trustBand(RULES.trust.waryBelow)).toBe("STEADY");
    expect(trustBand(RULES.trust.assuredAbove)).toBe("STEADY");
    expect(trustBand(RULES.trust.assuredAbove + 1)).toBe("ASSURED");
    expect(clampTrust(-12)).toBe(0);
    expect(clampTrust(140)).toBe(100);
  });
});

describe("trust changes how the same mech plays", () => {
  // A defended approach: enough threat on the axis that hedging and committing
  // actually pick different ground.
  const battlefield = () =>
    openGame({
      w: 16,
      h: 9,
      objective: { kind: "seize", turnLimit: 12, zone: [axial(14, 4)], attacker: "blue" },
      units: [
        place("mech_assault", "blue", axial(2, 4), 0, "ai"),
        place("armor", "red", axial(8, 4), 3, "ai"),
        place("armor", "red", axial(8, 2), 3, "ai"),
        place("atgm_team", "red", axial(9, 6), 3, "ai"),
      ],
    });

  it("an ASSURED mech ends closer to the objective than the SAME mech run WARY", () => {
    const s = battlefield();
    beginTurn(s);
    s.phase = "maneuver";
    const mech = find(s, "mech_assault");
    const goal = s.objective.zone[0];

    mech.trust = 20; // WARY — pays more for exposure, leans on the objective less
    const wary = decideUnit(s, mech);
    mech.trust = 80; // ASSURED — same machine, same name, different history
    const assured = decideUnit(s, mech);

    expect(hexDistance(assured.destination, goal)).toBeLessThan(hexDistance(wary.destination, goal));
  });

  it("neutral trust (50) decides exactly like a skirmish mech (no value at all)", () => {
    const s = battlefield();
    beginTurn(s);
    s.phase = "maneuver";
    const mech = find(s, "mech_assault");
    const bare = decideUnit(s, mech); // skirmish: trust undefined
    mech.trust = 50;
    const neutral = decideUnit(s, mech);
    expect(neutral.destination).toEqual(bare.destination);
    expect(neutral.stance).toBe(bare.stance);
  });
});

describe("the ledger — trust is earned battle by battle", () => {
  const staged = (): { op: OperationState; state: ReturnType<typeof prepareBattle> } => {
    const op = createOperation("op01", 5);
    buySupport(op, "supply");
    finishInterlude(op);
    return { op, state: prepareBattle(op) };
  };

  it("a fed, winning mech gains trust; the notes say why", () => {
    const { op, state } = staged();
    const mech = state.units.find((u) => u.callSign && u.side === "blue")!;
    const truck = state.units.find((u) => u.typeId === "supply" && u.side === "blue")!;
    expect(mech.trust).toBe(trustOf(op, mech.callSign)); // injected by prepareBattle (refit already moved it)
    const before = trustOf(op, mech.callSign);

    for (let i = 0; i < 2; i++) emit(state, { kind: "resupply", id: truck.id, side: "blue", targetId: mech.id, ammo: 4, fuel: 0 });
    state.outcome = "blue";
    state.turn = 8;
    recordBattle(op, state);

    expect(trustOf(op, mech.callSign)).toBe(before + RULES.trust.deltas.win + 2 * RULES.trust.deltas.resupplyEach);
    const note = op.trustNotes.find((n) => n.startsWith(mech.callSign!))!;
    expect(note).toContain("we won");
    expect(note).toContain("2 resupply runs reached me");
  });

  it("losing while cut off costs trust; a dead name costs the survivors", () => {
    // Battle two (the Crossing) fields TWO mech slots — requisition a second
    // name so one can die and the other can remember it.
    const op = createOperation("op01", 5);
    op.stockpile = { ...op.stockpile, credits: 999 };
    requisitionMech(op);
    buySupport(op, "supply");
    op.battleIndex = 1;
    finishInterlude(op);
    const state = prepareBattle(op);
    const mechs = state.units.filter((u) => u.callSign && u.side === "blue");
    expect(mechs.length).toBe(2);
    const dead = mechs[0];
    const survivor = mechs[1];
    const before = trustOf(op, survivor.callSign);

    dead.structure = 0; // a name dies
    survivor.inSupply = false; // and the survivor ends the battle cut off
    state.outcome = "red";
    recordBattle(op, state);

    const D = RULES.trust.deltas;
    expect(trustOf(op, survivor.callSign)).toBe(clampTrust(before + D.loss + D.endedStarved + D.mechLost));
    const note = op.trustNotes.find((n) => n.startsWith(survivor.callSign!))!;
    expect(note).toContain("cut off");
    expect(note).toContain(`we lost ${dead.callSign}`);
    expect(op.trustNotes.some((n) => n.startsWith(dead.callSign!))).toBe(false); // the dead keep no ledger
  });

  it("the refit answers too: unmet REQUESTs cost trust, a clean refit earns it", () => {
    const op = createOperation("op01", 5);
    const mech = op.roster.find((r) => unitType(r.typeId).cls === "mech")!;
    mech.structure = 5;
    op.stockpile = { ...op.stockpile, repair: 0, ammo: 0, fuel: 0 }; // an empty depot
    const before = trustOf(op, mech.callSign);
    const report = commanderRefit(op);
    expect(trustOf(op, mech.callSign)).toBeLessThan(before);
    expect(report.find((l) => l.startsWith(mech.callSign!))).toContain("trust -");

    const op2 = createOperation("op01", 5);
    const mech2 = op2.roster.find((r) => unitType(r.typeId).cls === "mech")!;
    const before2 = trustOf(op2, mech2.callSign);
    commanderRefit(op2); // healthy mech, stocked depot — combat ready
    expect(trustOf(op2, mech2.callSign)).toBe(before2 + RULES.trust.deltas.fullRefit);
  });

  it("a requisitioned recruit arrives with no history (neutral trust)", () => {
    const op = createOperation("op01", 5);
    op.roster.find((r) => unitType(r.typeId).cls === "mech")!.alive = false;
    op.stockpile = { ...op.stockpile, credits: 999 };
    op.trust[op.roster[0].callSign!] = 80; // the old hands trust you
    const r = requisitionMech(op);
    expect(trustOf(op, r.callSign)).toBe(RULES.trust.start); // the recruit doesn't yet
  });

  it("round-trips through the checkpoint save and rides into the next battle", () => {
    const { op, state } = staged();
    state.outcome = "blue";
    recordBattle(op, state);
    const back = JSON.parse(JSON.stringify(op)) as OperationState;
    expect(back.trust).toEqual(op.trust);
    finishInterlude(back);
    const next = prepareBattle(back);
    const mech = next.units.find((u) => u.callSign && u.side === "blue")!;
    expect(mech.trust).toBe(trustOf(back, mech.callSign)); // history rides along
  });
});

describe("legibility — trust is visible everywhere it acts", () => {
  it("skirmish mechs carry no trust at all", () => {
    const s = createGame(mapById("map01"), 1);
    for (const u of livingUnits(s, "blue")) expect(u.trust).toBeUndefined();
  });

  it("the deployment quotes carry the band; skirmish quotes don't", () => {
    const op = createOperation("op01", 5);
    finishInterlude(op);
    const state = prepareBattle(op);
    const lines = commanderNeeds(state, "blue");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].text).toContain("· STEADY)");

    const skirmish = openGame({
      units: [place("mech_assault", "blue", axial(2, 2), 0, "ai"), place("armor", "red", axial(9, 2), 3, "ai")],
    });
    skirmish.deployPending = true;
    expect(commanderNeeds(skirmish, "blue")[0].text).not.toContain("· STEADY");
  });

  it("the needs panel warns at the edges and says what changes", () => {
    const s = openGame({
      units: [place("mech_assault", "blue", axial(2, 2), 0, "ai"), place("armor", "red", axial(9, 2), 3, "ai")],
    });
    const mech = find(s, "mech_assault");
    mech.trust = 20;
    expect(commanderNeeds(s, "blue").some((n) => n.urgency === "warn" && n.text.includes("doubts the support"))).toBe(true);
    mech.trust = 80;
    expect(commanderNeeds(s, "blue").some((n) => n.text.includes("trusts the line"))).toBe(true);
    mech.trust = undefined;
    expect(commanderNeeds(s, "blue").some((n) => n.text.includes("trust"))).toBe(false);
  });
});
