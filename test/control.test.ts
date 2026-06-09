import { describe, it, expect } from "vitest";
import { openGame, place } from "./helpers";
import type { Hex } from "../src/sim/hex";
import { hexKey } from "../src/sim/hex";
import { updateBelief } from "../src/sim/knowledge";
import {
  attackOptions,
  attackPreviews,
  bestWeaponIndex,
  canReserve,
  cardModel,
  forceCards,
  hasActivationLeft,
  inspectModel,
  isPlayerControllable,
  moveOptions,
  readyToOrder,
  resupplyOptions,
  selectableUnitIdAt,
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

  it("cardModel surfaces suppression, crits and reserve state", () => {
    const s = openGame({ units: [place("recon", "blue", H(2, 1), 0, "player")] });
    const recon = s.units.find((u) => u.typeId === "recon")!;
    recon.suppression = 4; // half-way to the morale break (8)
    recon.crits.push("mobility");
    recon.reserved = true;
    const m = cardModel(s, recon);
    expect(m.suppressionFrac).toBeCloseTo(0.5, 5);
    expect(m.crits).toContain("mobility");
    expect(m.reserved).toBe(true);
    expect(m.ready).toBe(false); // reserved in its home phase → not orderable now
  });

  it("canReserve only before acting, outside the maneuver phase", () => {
    const s = openGame({ units: [place("recon", "blue", H(2, 1), 0, "player")] });
    const recon = s.units.find((u) => u.typeId === "recon")!;
    expect(canReserve(s, recon)).toBe(true); // recon phase, fresh
    recon.movedThisTurn = true;
    expect(canReserve(s, recon)).toBe(false); // already committed to acting now
    recon.movedThisTurn = false;
    s.phase = "maneuver";
    expect(canReserve(s, recon)).toBe(false); // nothing left to defer to
  });

  it("bestWeaponIndex picks the weapon that actually works (penetration, ammo)", () => {
    // An AI mech carries two weapons (AC pen 8, SRM pen 6); the MBT's front
    // armour is 7 — only the autocannon penetrates, so it must be chosen.
    const s = openGame({
      units: [place("mech_assault", "blue", H(2, 2), 0, "ai"), place("armor", "red", H(5, 2), 3, "ai")],
    });
    s.phase = "maneuver";
    const mech = s.units.find((u) => u.typeId === "mech_assault")!;
    const tank = s.units.find((u) => u.typeId === "armor")!;
    expect(bestWeaponIndex(s, mech, tank)).toBe(0);
    mech.ammo[0] = 0; // autocannon dry → the SRM (suppression value) is all that's left
    expect(bestWeaponIndex(s, mech, tank)).toBe(1);
    mech.ammo[1] = 0;
    expect(bestWeaponIndex(s, mech, tank)).toBeNull(); // nothing can engage
  });

  it("attackPreviews reports the same hit chance the roll will use", () => {
    const s = openGame({
      units: [place("recon", "blue", H(2, 1), 0, "player"), place("infantry", "red", H(4, 0), 0, "ai")],
    });
    const recon = s.units.find((u) => u.typeId === "recon")!;
    const enemy = s.units.find((u) => u.side === "red")!;
    const previews = attackPreviews(s, recon);
    expect(previews).toHaveLength(1);
    expect(previews[0].id).toBe(enemy.id);
    expect(previews[0].hitPct).toBe(60); // MG accuracy 0.6, open ground, no suppression
  });
});

describe("ui control — fog of war (selection & inspection use belief, not truth)", () => {
  it("an unscouted enemy is unselectable; a seen one selects at its hex", () => {
    const s = openGame({
      w: 30,
      units: [
        place("recon", "blue", H(2, 1), 0, "player"),
        place("infantry", "red", H(8, 1), 0, "ai"), // within vision 12
        place("armor", "red", H(28, -10), 3, "ai"), // far beyond sight
      ],
    });
    updateBelief(s, "blue");
    const seen = s.units.find((u) => u.typeId === "infantry")!;
    const unseen = s.units.find((u) => u.typeId === "armor")!;
    expect(selectableUnitIdAt(s, "blue", seen.hex)).toBe(seen.id);
    expect(selectableUnitIdAt(s, "blue", unseen.hex)).toBeNull(); // doesn't exist to blue
  });

  it("a remembered enemy selects at its LAST-KNOWN hex, not its true one", () => {
    const s = openGame({
      w: 30,
      units: [place("recon", "blue", H(2, 1), 0, "player"), place("infantry", "red", H(8, 1), 0, "ai")],
    });
    updateBelief(s, "blue"); // sighted at (8,1)
    const enemy = s.units.find((u) => u.side === "red")!;
    const lastKnown = { ...enemy.hex };
    enemy.hex = H(28, -10); // slips away out of sight
    updateBelief(s, "blue"); // now only a memory
    expect(selectableUnitIdAt(s, "blue", lastKnown)).toBe(enemy.id); // the ghost
    expect(selectableUnitIdAt(s, "blue", enemy.hex)).toBeNull(); // true position unknown
  });

  it("inspectModel for an enemy reports believed state, flagged stale", () => {
    const s = openGame({
      w: 30,
      units: [place("recon", "blue", H(2, 1), 0, "player"), place("infantry", "red", H(8, 1), 0, "ai")],
    });
    updateBelief(s, "blue");
    const enemy = s.units.find((u) => u.side === "red")!;

    const live = inspectModel(s, "blue", enemy.id, null);
    expect(live?.kind).toBe("enemy");
    if (live?.kind === "enemy") expect(live.live).toBe(true);

    enemy.hex = H(28, -10); // breaks contact...
    enemy.structure = 1; // ...and takes a beating somewhere unseen
    updateBelief(s, "blue");
    const stale = inspectModel(s, "blue", enemy.id, null);
    expect(stale?.kind).toBe("enemy");
    if (stale?.kind === "enemy") {
      expect(stale.live).toBe(false); // remembered, not in sight
      expect(stale.structureFrac).toBe(1); // belief still says healthy — no leak
    }
  });

  it("inspectModel: own units get full data; empty hexes get terrain", () => {
    const s = openGame({
      units: [place("recon", "blue", H(2, 1), 0, "player")],
      terrain: [{ hex: H(5, 0), terrain: "woods" }],
    });
    const recon = s.units.find((u) => u.typeId === "recon")!;
    const own = inspectModel(s, "blue", recon.id, null);
    expect(own?.kind).toBe("own");
    if (own?.kind === "own") expect(own.card.id).toBe(recon.id);

    const ground = inspectModel(s, "blue", null, H(5, 0));
    expect(ground?.kind).toBe("terrain");
    if (ground?.kind === "terrain") expect(ground.terrain.name).toBe("Woods");

    expect(inspectModel(s, "blue", 999, null)).toBeNull(); // unknown id → nothing
  });
});
