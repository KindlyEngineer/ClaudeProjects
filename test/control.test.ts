import { describe, it, expect } from "vitest";
import { openGame, place } from "./helpers";
import type { Hex } from "../src/sim/hex";
import { hexKey } from "../src/sim/hex";
import {
  attackOptions,
  cardModel,
  forceCards,
  hasActivationLeft,
  isPlayerControllable,
  moveOptions,
  readyToOrder,
  resupplyOptions,
} from "../src/ui/control";

// The interactive UI's rules-facing logic (what the player may select/command
// now) is pure, so it's unit-tested here without any DOM/Three. The brief's
// load-bearing invariant — the player commands ONLY their own units, never the
// mechs — is asserted directly.

const H = (q: number, r: number): Hex => ({ q, r });

describe("ui control — selection & command gating", () => {
  it("only the player's own units are controllable (mechs/enemy never are)", () => {
    const s = openGame({
      units: [
        place("recon", "blue", H(2, 1), 0, "player"),
        place("mech_assault", "blue", H(1, 1), 0, "ai"),
        place("infantry", "red", H(8, 1), 0, "ai"),
      ],
    });
    const recon = s.units.find((u) => u.typeId === "recon")!;
    const mech = s.units.find((u) => u.typeId === "mech_assault")!;
    const enemy = s.units.find((u) => u.side === "red")!;
    expect(isPlayerControllable(recon)).toBe(true);
    expect(isPlayerControllable(mech)).toBe(false); // a mech is the AI's, never the player's
    expect(isPlayerControllable(enemy)).toBe(false);
  });

  it("readyToOrder needs ownership, the unit's phase, and an unspent activation", () => {
    const s = openGame({
      units: [
        place("recon", "blue", H(2, 1), 0, "player"), // home phase = recon (the default phase)
        place("armor", "blue", H(2, 2), 0, "player"), // home phase = maneuver
        place("mech_assault", "blue", H(1, 1), 0, "ai"),
      ],
    });
    const recon = s.units.find((u) => u.typeId === "recon")!;
    const armor = s.units.find((u) => u.typeId === "armor")!;
    const mech = s.units.find((u) => u.typeId === "mech_assault")!;

    expect(readyToOrder(s, recon)).toBe(true); // player, its phase, fresh
    expect(readyToOrder(s, armor)).toBe(false); // wrong phase (maneuver) in recon
    expect(readyToOrder(s, mech)).toBe(false); // AI-controlled

    recon.movedThisTurn = true;
    expect(hasActivationLeft(recon)).toBe(true); // can still act
    expect(readyToOrder(s, recon)).toBe(true);
    recon.actedThisTurn = true;
    expect(hasActivationLeft(recon)).toBe(false); // fully spent
    expect(readyToOrder(s, recon)).toBe(false);
  });

  it("moveOptions lists reachable hexes (excluding the current) and clears once moved", () => {
    const s = openGame({ units: [place("recon", "blue", H(2, 1), 0, "player")] });
    const recon = s.units.find((u) => u.typeId === "recon")!;
    const opts = moveOptions(s, recon);
    expect(opts.size).toBeGreaterThan(0);
    expect(opts.has(hexKey(recon.hex))).toBe(false); // not the hex it's standing on
    recon.movedThisTurn = true;
    expect(moveOptions(s, recon).size).toBe(0);
  });

  it("attackOptions surfaces only visible, in-range enemies", () => {
    const near = openGame({
      units: [place("recon", "blue", H(2, 1), 0, "player"), place("infantry", "red", H(4, 0), 0, "ai")],
    });
    const recon = near.units.find((u) => u.typeId === "recon")!;
    const enemy = near.units.find((u) => u.side === "red")!;
    const opts = attackOptions(near, recon);
    expect(opts.has(enemy.id)).toBe(true); // distance 2, within the MG's range 4
    expect(opts.get(enemy.id)).toBe(0);

    const far = openGame({
      units: [place("recon", "blue", H(2, 1), 0, "player"), place("infantry", "red", H(10, -3), 0, "ai")],
    });
    const r2 = far.units.find((u) => u.typeId === "recon")!;
    expect(attackOptions(far, r2).size).toBe(0); // seen (vision 12) but out of weapon range
  });

  it("resupplyOptions lists adjacent needy allies for a supply unit in its phase", () => {
    const s = openGame({
      units: [
        place("supply", "blue", H(3, 2), 0, "player"),
        place("armor", "blue", H(4, 1), 0, "player"), // adjacent
        place("infantry", "blue", H(8, 1), 0, "player"), // distant
      ],
    });
    s.phase = "maneuver"; // supply's home phase
    const supply = s.units.find((u) => u.typeId === "supply")!;
    const armor = s.units.find((u) => u.typeId === "armor")!;
    const infantry = s.units.find((u) => u.typeId === "infantry")!;
    armor.fuel = 0; // make it needy

    const opts = resupplyOptions(s, supply);
    expect(opts.has(armor.id)).toBe(true);
    expect(opts.has(infantry.id)).toBe(false); // not adjacent

    s.phase = "recon"; // out of the supply unit's phase
    expect(resupplyOptions(s, supply).size).toBe(0);
  });

  it("cardModel/forceCards reflect readiness, control, and mech intent", () => {
    const s = openGame({
      units: [
        place("recon", "blue", H(2, 1), 0, "player"),
        place("mech_assault", "blue", H(1, 1), 0, "ai"),
        place("infantry", "red", H(8, 1), 0, "ai"),
      ],
    });
    const mech = s.units.find((u) => u.typeId === "mech_assault")!;
    s.intents[mech.id] = "Advancing on the objective";

    const cards = forceCards(s, "blue");
    expect(cards.map((c) => c.id)).not.toContain(s.units.find((u) => u.side === "red")!.id); // own force only
    expect(cards[0].controllable).toBe(true); // player units sort first

    const mechCard = cardModel(s, mech);
    expect(mechCard.controllable).toBe(false);
    expect(mechCard.ready).toBe(false);
    expect(mechCard.intent).toBe("Advancing on the objective"); // mechs show commander intent
  });
});
