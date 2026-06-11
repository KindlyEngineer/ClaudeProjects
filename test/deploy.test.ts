import { describe, it, expect } from "vitest";
import { canDeploy, confirmDeployment, deployUnit } from "../src/sim/actions";
import { buySupport, createOperation, deriveDeployZone, finishInterlude, prepareBattle } from "../src/sim/operation";
import { mapById } from "../src/data/operations";
import { createGame } from "../src/sim/state";
import { MAP04 } from "../src/data/maps/map04";
import { hexKey } from "../src/sim/hex";
import { unitType } from "../src/data/units";

// M2.6 — deployment: the composed echelon is PLACED by the player inside a
// start zone at battle outset (operations only). The commander posts its own
// mechs; the player's freedom is the zone.

describe("deployment zones", () => {
  it("attacker zones hug the home edge; defender zones hug the objective", () => {
    const attack = deriveDeployZone(mapById("map01")); // blue attacks
    const minQ = Math.min(...mapById("map01").cells.map((c) => c.hex.q));
    expect(attack.length).toBeGreaterThan(10);
    expect(attack.every((h) => h.q <= minQ + 3)).toBe(true);

    const defend = deriveDeployZone(MAP04); // blue holds the crossroads
    expect(defend.length).toBeGreaterThan(10);
    const zone = MAP04.objective.zone[0];
    expect(defend.some((h) => hexKey(h) === hexKey(zone))).toBe(true); // the objective is inside it
  });
});

describe("deployment flow", () => {
  const staged = () => {
    const op = createOperation("op01", 11);
    for (const t of ["recon", "artillery", "supply", "engineer"]) buySupport(op, t);
    finishInterlude(op);
    return { op, state: prepareBattle(op) };
  };

  it("the composed echelon spawns inside the zone, pending placement", () => {
    const { state } = staged();
    expect(state.deployPending).toBe(true);
    const zoneKeys = new Set(state.deployZone.map(hexKey));
    const echelon = state.units.filter((u) => u.controller === "player");
    expect(echelon.length).toBe(4); // exactly what was bought
    expect(echelon.every((u) => zoneKeys.has(hexKey(u.hex)))).toBe(true);
  });

  it("placement is free inside the zone, refused outside, mechs refused", () => {
    const { state } = staged();
    const truck = state.units.find((u) => u.typeId === "supply" && u.controller === "player")!;
    const mech = state.units.find((u) => unitType(u.typeId).cls === "mech")!;
    const inZone = state.deployZone.find(
      (h) => !state.units.some((u) => u.structure > 0 && hexKey(u.hex) === hexKey(h)),
    )!;
    const fuel0 = truck.fuel;

    expect(deployUnit(state, truck, inZone).ok).toBe(true);
    expect(hexKey(truck.hex)).toBe(hexKey(inZone));
    expect(truck.fuel).toBe(fuel0); // free — the battle hasn't started

    expect(canDeploy(state, truck, { q: 15, r: 5 }).reason).toBe("outside the deployment zone");
    expect(canDeploy(state, truck, mech.hex).reason).toBe("occupied");
    expect(canDeploy(state, mech, inZone).reason).toBe("the commander posts its own mechs");

    confirmDeployment(state);
    expect(state.deployPending).toBe(false);
    expect(canDeploy(state, truck, inZone).reason).toBe("not in deployment"); // the line is locked
  });

  it("skirmishes don't deploy (operations only)", () => {
    // createGame on a plain map leaves deployPending false (ruling D-deploy).
    const { state } = staged();
    expect(state.deployPending).toBe(true); // operation battle: yes
    const skirmish = createGame(mapById("map01"), 1);
    expect(skirmish.deployPending).toBe(false); // skirmish: no
  });
});
