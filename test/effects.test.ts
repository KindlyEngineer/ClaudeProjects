import { describe, it, expect } from "vitest";
import { canFireMission, canFortify, fireMission, fortifyHex } from "../src/sim/actions";
import { commandForce } from "../src/sim/ai";
import { hitChance } from "../src/sim/combat";
import { addEffect, coverAt, hasEffect, moveCostAt, sightBlockedAt } from "../src/sim/effects";
import { reachable } from "../src/sim/pathing";
import { hexKey } from "../src/sim/hex";
import { beginTurn, nextPhase } from "../src/sim/turn";
import { unitType } from "../src/data/units";
import { canSee } from "../src/sim/vision";
import { axial, find, openGame, place } from "./helpers";

// Battlefield effects (smoke / fortifications) + the support verbs that create
// them. The load-bearing property: effects flow through the SHARED ground
// queries, so movement, combat cover, vision and the AI's own scoring all feel
// them — laying smoke genuinely blinds, fortifying genuinely slows and shelters.

describe("battlefield effects — shared ground queries", () => {
  it("smoke blocks sightlines crossing it and expires on schedule", () => {
    const s = openGame({
      w: 16,
      units: [place("recon", "blue", axial(1, 2)), place("infantry", "red", axial(7, 2), 3)],
    });
    beginTurn(s);
    const recon = find(s, "recon");
    const enemy = find(s, "infantry", "red");
    expect(canSee(s, recon, enemy.hex)).toBe(true);

    addEffect(s, "smoke", axial(4, 2)); // a screen across the sightline
    expect(sightBlockedAt(s, axial(4, 2))).toBe(true);
    expect(canSee(s, recon, enemy.hex)).toBe(false); // blinded

    // Smoke lasts its rated duration, then dissipates in upkeep.
    s.turn += 1;
    beginTurn(s);
    expect(hasEffect(s, axial(4, 2), "smoke")).toBe(true); // still standing
    s.turn += 1;
    beginTurn(s);
    expect(hasEffect(s, axial(4, 2), "smoke")).toBe(false); // gone
    expect(canSee(s, recon, enemy.hex)).toBe(true);
  });

  it("fortifications slow movement and add cover (combat + pathing feel it)", () => {
    const s = openGame({
      units: [place("armor", "blue", axial(1, 2), 0), place("infantry", "red", axial(4, 2), 3)],
    });
    beginTurn(s);
    s.phase = "maneuver";
    const armor = find(s, "armor");
    const enemy = find(s, "infantry", "red");
    const weapon = unitType(armor.typeId).weapons[0];

    const openHit = hitChance(s, armor, weapon, enemy);
    const openCost = moveCostAt(s, axial(3, 2));
    addEffect(s, "fortification", axial(4, 2)); // the enemy digs in
    addEffect(s, "fortification", axial(3, 2));
    expect(coverAt(s, axial(4, 2))).toBeGreaterThan(0);
    expect(hitChance(s, armor, weapon, enemy)).toBeLessThan(openHit); // harder to hit
    expect(moveCostAt(s, axial(3, 2))).toBeGreaterThan(openCost); // slower to cross

    // Reachability pays the surcharge: route cost = one open step (1) + the
    // fortified hex's raised entry cost.
    const reach = reachable(s, armor);
    const node = reach.get(hexKey(axial(3, 2)));
    expect(node).toBeDefined();
    expect(node!.cost).toBe(1 + moveCostAt(s, axial(3, 2)));
  });
});

describe("fire missions (artillery support verbs)", () => {
  const battery = () =>
    openGame({
      w: 18,
      units: [
        place("artillery", "blue", axial(1, 2)),
        place("recon", "blue", axial(6, 2)), // the forward observer
        place("infantry", "red", axial(9, 2), 3),
        place("armor", "red", axial(10, 2), 3), // adjacent pair = a cluster
      ],
    });

  it("suppression saturates the area: every enemy in the footprint is rattled", () => {
    const s = battery();
    beginTurn(s);
    s.phase = "fires";
    const guns = find(s, "artillery");
    const inf = find(s, "infantry", "red");
    const tank = find(s, "armor", "red");
    const ammo0 = guns.ammo[0];

    const r = fireMission(s, guns, inf.hex, "suppress");
    expect(r.ok).toBe(true);
    expect(r.suppressed).toBe(2); // both enemies inside radius 1
    expect(inf.suppression).toBeGreaterThan(0);
    expect(tank.suppression).toBeGreaterThan(0);
    expect(inf.structure).toBe(unitType(inf.typeId).structure); // saturation pins, it doesn't kill
    expect(guns.ammo[0]).toBe(ammo0 - 2); // missions are ammo-hungry
    expect(guns.actedThisTurn).toBe(true);
    expect(fireMission(s, guns, inf.hex, "suppress").ok).toBe(false); // one action per turn
  });

  it("suppression needs an observer; smoke screens unobserved ground", () => {
    const s = openGame({
      w: 30,
      units: [place("artillery", "blue", axial(1, 2)), place("infantry", "red", axial(20, 2), 3)],
    });
    beginTurn(s);
    s.phase = "fires";
    const guns = find(s, "artillery");
    const far = axial(20, 2); // in range (155mm reaches 34) but nobody has eyes on it
    expect(canFireMission(s, guns, far, "suppress").reason).toBe("target not observed");
    expect(canFireMission(s, guns, far, "smoke").ok).toBe(true);

    const r = fireMission(s, guns, far, "smoke");
    expect(r.ok).toBe(true);
    expect(r.hexes.length).toBe(7); // the full footprint
    for (const h of r.hexes) expect(hasEffect(s, h, "smoke")).toBe(true);
  });

  it("respects range and ammo", () => {
    const s = battery();
    beginTurn(s);
    s.phase = "fires";
    const guns = find(s, "artillery");
    expect(canFireMission(s, guns, axial(2, 2), "smoke").reason).toBe("out of range"); // inside min range 4
    guns.ammo[0] = 1;
    expect(canFireMission(s, guns, axial(9, 2), "smoke").reason).toBe("not enough ammo");
  });
});

describe("fortify (engineer support verb)", () => {
  it("an engineer digs in its own or an adjacent hex, once per spot", () => {
    const s = openGame({ units: [place("engineer", "blue", axial(3, 2))] });
    beginTurn(s);
    s.phase = "maneuver";
    const eng = find(s, "engineer");
    expect(fortifyHex(s, eng, eng.hex).ok).toBe(true);
    expect(hasEffect(s, eng.hex, "fortification")).toBe(true);
    expect(eng.actedThisTurn).toBe(true);
    expect(canFortify(s, eng, eng.hex).reason).toBe("already acted");
    eng.actedThisTurn = false;
    expect(canFortify(s, eng, eng.hex).reason).toBe("already fortified");
    expect(canFortify(s, eng, axial(6, 2)).reason).toBe("not adjacent");
  });
});

describe("the AI uses the support verbs", () => {
  it("AI artillery fires an area mission at a visible cluster", () => {
    const s = openGame({
      w: 18,
      units: [
        place("artillery", "blue", axial(1, 2)),
        place("recon", "blue", axial(6, 2)),
        place("infantry", "red", axial(9, 2), 3),
        place("armor", "red", axial(10, 2), 3),
      ],
    });
    beginTurn(s);
    s.phase = "fires"; // artillery's home phase
    commandForce(s, "blue");
    const ev = s.events.find((e) => e.kind === "mission");
    expect(ev).toBeDefined();
    if (ev?.kind === "mission") {
      expect(ev.mission).toBe("suppress");
      expect(ev.suppressedIds.length).toBeGreaterThanOrEqual(2); // it took the cluster, not a single mark
    }
  });

  it("a DEFENDING AI engineer fortifies its position on a hold", () => {
    const s = openGame({
      objective: { kind: "seize", turnLimit: 10, zone: [axial(4, 2)], attacker: "red" }, // blue defends
      units: [place("engineer", "blue", axial(4, 2)), place("mech_assault", "red", axial(10, 2), 3)],
    });
    beginTurn(s);
    nextPhase(s);
    nextPhase(s); // maneuver — the engineer's phase
    commandForce(s, "blue");
    expect(s.events.some((e) => e.kind === "build")).toBe(true);
  });
});
