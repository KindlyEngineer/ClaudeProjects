import { describe, it, expect } from "vitest";
import { canAttack } from "../src/sim/actions";
import { commandForce } from "../src/sim/ai";
import { callReconFlight, callStrike, canCallStrike } from "../src/sim/offmap";
import { isScouted } from "../src/sim/vision";
import { beginTurn, nextPhase } from "../src/sim/turn";
import { axial, find, openGame, place } from "./helpers";

// Off-map air assets (M1): side-level strike + recon overflight, budgeted per
// battle. The forward-observer rule extends to the air (strikes need an
// observed target); an overflight IS an observer for the rest of the turn.

function withAir(opts: Parameters<typeof openGame>[0]) {
  const s = openGame(opts);
  s.offmap.blue = { strike: 2, recon: 2 };
  s.offmap.red = { strike: 1, recon: 1 };
  return s;
}

describe("recon overflight", () => {
  it("buys a turn of eyes: unscouted ground becomes observed, then expires", () => {
    const s = withAir({ w: 30, units: [place("artillery", "blue", axial(1, 2)), place("infantry", "red", axial(20, 2), 3)] });
    beginTurn(s);
    const deep = axial(20, 2); // far beyond any blue unit's sight
    expect(isScouted(s, "blue", deep)).toBe(false);

    const r = callReconFlight(s, "blue", deep);
    expect(r.ok).toBe(true);
    expect(isScouted(s, "blue", deep)).toBe(true); // coverage = observation
    expect(s.belief.blue.get(find(s, "infantry", "red").id)?.visibleNow).toBe(true); // sighting injected NOW
    expect(s.offmap.blue.recon).toBe(1);

    s.turn += 1;
    beginTurn(s); // the picture goes stale with the dawn
    expect(isScouted(s, "blue", deep)).toBe(false);
  });

  it("an overflight makes deep fires legal (artillery + strikes through air eyes)", () => {
    const s = withAir({ w: 30, units: [place("artillery", "blue", axial(1, 2)), place("infantry", "red", axial(20, 2), 3)] });
    beginTurn(s);
    s.phase = "fires";
    const guns = find(s, "artillery");
    const enemy = find(s, "infantry", "red");
    expect(canAttack(s, guns, 0, enemy)).toBe(false); // blind battery holds fire
    expect(canCallStrike(s, "blue", enemy.hex).reason).toBe("target not observed");

    callReconFlight(s, "blue", enemy.hex);
    expect(canAttack(s, guns, 0, enemy)).toBe(true); // the flight is the observer
    expect(canCallStrike(s, "blue", enemy.hex).ok).toBe(true);
  });
});

describe("air strike", () => {
  it("needs budget + an observed target; hits the footprint, spends the sortie", () => {
    const s = withAir({
      w: 16,
      units: [
        place("recon", "blue", axial(4, 2)),
        place("infantry", "red", axial(8, 2), 3),
        place("armor", "red", axial(9, 2), 3),
      ],
    });
    beginTurn(s);
    const inf = find(s, "infantry", "red");
    const tank = find(s, "armor", "red");

    const r = callStrike(s, "blue", inf.hex);
    expect(r.ok).toBe(true);
    expect(s.offmap.blue.strike).toBe(1);
    expect(inf.suppression).toBeGreaterThan(0); // everyone under the bombs is rattled
    expect(tank.suppression).toBeGreaterThan(0);
    // Determinism: the same seed replays the same strike.
    const s2 = withAir({
      w: 16,
      units: [
        place("recon", "blue", axial(4, 2)),
        place("infantry", "red", axial(8, 2), 3),
        place("armor", "red", axial(9, 2), 3),
      ],
    });
    beginTurn(s2);
    const r2 = callStrike(s2, "blue", find(s2, "infantry", "red").hex);
    expect(r2.hits).toEqual(r.hits);

    s.offmap.blue.strike = 0;
    expect(callStrike(s, "blue", inf.hex).reason).toBe("no strike sorties left");
  });
});

describe("the AI calls its own air", () => {
  it("strikes a visible cluster; flies recon when blind", () => {
    // Cluster in view → the AI spends a strike on it.
    const cluster = withAir({
      w: 18,
      units: [
        place("recon", "blue", axial(4, 2), 0, "ai"),
        place("infantry", "red", axial(8, 2), 3, "ai"),
        place("armor", "red", axial(9, 2), 3, "ai"),
      ],
    });
    beginTurn(cluster);
    commandForce(cluster, "blue");
    expect(cluster.events.some((e) => e.kind === "offmap" && e.asset === "strike" && e.side === "blue")).toBe(true);

    // Nothing in view → it buys eyes instead.
    const blind = withAir({
      w: 30,
      objective: { kind: "seize", turnLimit: 10, zone: [axial(24, 2)], attacker: "blue" },
      units: [place("artillery", "blue", axial(1, 2), 0, "ai"), place("infantry", "red", axial(24, 2), 3, "ai")],
    });
    beginTurn(blind);
    nextPhase(blind); // fires — the artillery's phase, after the (empty) recon phase
    commandForce(blind, "blue");
    expect(blind.events.some((e) => e.kind === "offmap" && e.asset === "recon" && e.side === "blue")).toBe(true);
  });
});
