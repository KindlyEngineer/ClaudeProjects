import { describe, it, expect } from "vitest";
import { canAttack } from "../src/sim/actions";
import { damageComponent, weaponDisabled } from "../src/sim/combat";
import { callStrike } from "../src/sim/offmap";
import { commanderRefit, createOperation, finishInterlude, prepareBattle, recordBattle, requisitionMech } from "../src/sim/operation";
import { createGame, livingUnits } from "../src/sim/state";
import { noSupport, runMatch } from "../src/sim/match";
import { beginTurn } from "../src/sim/turn";
import { unitType } from "../src/data/units";
import { randomSkirmishMap } from "../src/data/maps/gen";
import { axial, find, openGame, place } from "./helpers";

// M2.5 — unit detail (components) + variety. Crits now break SPECIFIC parts:
// a named mount dies, not an abstraction; damage is component-deep across the
// operation; every new type plays soundly under the same uniform model.

describe("component damage", () => {
  it("a weapon-mount hit disables THAT weapon; losing every mount = weapon crit", () => {
    const s = openGame({ units: [place("mech_assault", "blue", axial(1, 2)), place("infantry", "red", axial(3, 2), 3)] });
    beginTurn(s);
    s.phase = "maneuver";
    const mech = find(s, "mech_assault");
    const enemy = find(s, "infantry", "red");

    // Surgical: knock out the autocannon mount (roll 0 → first intact component).
    const name = damageComponent(mech, 0);
    expect(name).toBe("Autocannon mount");
    expect(weaponDisabled(mech, 0)).toBe(true);
    expect(weaponDisabled(mech, 1)).toBe(false);
    expect(canAttack(s, mech, 0, enemy)).toBe(false); // the AC is gone
    expect(canAttack(s, mech, 1, enemy)).toBe(true); // SRMs still up
    expect(mech.crits).not.toContain("weapon"); // not a total disarm yet

    expect(damageComponent(mech, 0)).toBe("SRM rack"); // next intact in order
    expect(mech.crits).toContain("weapon"); // NOW it's disarmed
  });

  it("mobility/sensors/crew components map onto the shared states", () => {
    const s = openGame({ units: [place("armor", "blue", axial(1, 2))] });
    const tank = find(s, "armor");
    // armor components order: gun, tracks, optics, crew.
    damageComponent(tank, 0.3); // → tracks (index 1 of 4)
    expect(tank.crits).toContain("mobility");
    damageComponent(tank, 0.5); // → optics (now index 1 of 3 intact)
    expect(tank.crits).toContain("sensors");
    damageComponent(tank, 0.9); // → crew (last intact non-gun)
    expect(tank.crits).toContain("shaken"); // the crew is rattled hard
  });

  it("components carry across battles and the depot repairs them BY NAME", () => {
    const op = createOperation("op01", 5);
    finishInterlude(op);
    const b1 = prepareBattle(op);
    const mech = b1.units.find((u) => u.callSign)!;
    damageComponent(mech, 0); // Autocannon mount out
    b1.outcome = "blue";
    recordBattle(op, b1);
    const rec = op.roster.find((r) => r.callSign === mech.callSign)!;
    expect(rec.componentsLost).toContain("ac_mount");

    op.stockpile = { ...op.stockpile, repair: 50, ammo: 0, fuel: 0 };
    const report = commanderRefit(op);
    expect(rec.componentsLost).toHaveLength(0); // the bench fixed the mount
    expect(report.join(" ")).toContain("Autocannon mount restored");
  });

  it("the requisition pool now includes the fire-support chassis", () => {
    const op = createOperation("op01", 5);
    for (const r of op.roster) if (unitType(r.typeId).cls === "mech") r.alive = false;
    op.stockpile = { ...op.stockpile, credits: 600 };
    const got = new Set<string>();
    for (let k = 0; k < 3; k++) {
      const res = requisitionMech(op);
      expect(res.ok).toBe(true);
      got.add(op.roster[op.roster.length - 1].typeId);
    }
    expect(got).toContain("mech_fire"); // variety reaches the yard
  });
});

describe("air defence (M2.5)", () => {
  it("an AA umbrella can drive a strike off — sortie spent, nothing hit", () => {
    // Deterministic: find a seed where the intercept roll fires, assert both paths.
    let intercepted = false;
    let landed = false;
    for (let seed = 1; seed <= 12 && !(intercepted && landed); seed++) {
      const s = openGame({
        w: 16,
        seed,
        units: [
          place("recon", "blue", axial(4, 2)),
          place("infantry", "red", axial(8, 2), 3),
          place("aa_vehicle", "red", axial(9, 2), 3),
        ],
      });
      s.offmap.blue = { strike: 1, recon: 0 };
      beginTurn(s);
      const inf = find(s, "infantry", "red");
      const r = callStrike(s, "blue", inf.hex);
      expect(r.ok).toBe(true);
      expect(s.offmap.blue.strike).toBe(0); // spent either way
      if (r.intercepted) {
        intercepted = true;
        expect(r.hits).toHaveLength(0);
        expect(inf.structure).toBe(unitType(inf.typeId).structure); // untouched
      } else {
        landed = true;
      }
    }
    expect(intercepted).toBe(true); // 55% per AA unit — 12 seeds always finds one
    expect(landed).toBe(true); // and the umbrella isn't a wall
  });
});

describe("the new types fight soundly", () => {
  it("a heavy random skirmish (heavy tank, AA, mortar, ATGM) terminates clean", () => {
    for (const seed of [2, 9]) {
      const map = randomSkirmishMap(seed, "heavy");
      const allAi = { ...map, units: map.units.map((u) => ({ ...u, controller: "ai" as const })) };
      const s = createGame(allAi, seed);
      const r = runMatch(s, noSupport);
      expect(["blue", "red"]).toContain(r.outcome);
      for (const u of livingUnits(s)) {
        expect(u.fuel).toBeGreaterThanOrEqual(0);
        expect(Math.min(0, ...u.ammo)).toBe(0);
      }
    }
  });
});
