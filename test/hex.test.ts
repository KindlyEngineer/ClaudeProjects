import { describe, it, expect } from "vitest";
import {
  armorArc,
  directionTo,
  DIRECTIONS,
  hexDistance,
  hexLine,
  hexToWorld,
  neighbor,
  neighbors,
  worldToHex,
  type Direction,
  type Hex,
} from "../src/sim/hex";

const O: Hex = { q: 0, r: 0 };

describe("hex geometry", () => {
  it("distance is 0 to self, 1 to each neighbour", () => {
    expect(hexDistance(O, O)).toBe(0);
    for (let d = 0; d < 6; d++) expect(hexDistance(O, neighbor(O, d as Direction))).toBe(1);
    expect(neighbors(O)).toHaveLength(6);
  });

  it("distance grows with separation", () => {
    expect(hexDistance(O, { q: 3, r: 0 })).toBe(3);
    expect(hexDistance(O, { q: -2, r: 2 })).toBe(2); // along a diagonal axis
    expect(hexDistance({ q: 1, r: -3 }, { q: -2, r: 2 })).toBe(5);
  });

  it("a line from a to b is contiguous and inclusive", () => {
    const b: Hex = { q: 3, r: -1 };
    const line = hexLine(O, b);
    expect(line[0]).toEqual(O);
    expect(line[line.length - 1]).toEqual(b);
    expect(line).toHaveLength(hexDistance(O, b) + 1);
    for (let i = 1; i < line.length; i++) expect(hexDistance(line[i - 1], line[i])).toBe(1);
  });

  it("directionTo recovers each pure direction", () => {
    for (let d = 0; d < 6; d++) {
      expect(directionTo(O, DIRECTIONS[d])).toBe(d);
    }
  });
});

describe("armour arcs (facing matters)", () => {
  it("a shot from straight ahead hits the front", () => {
    const facing: Direction = 0;
    const attacker = DIRECTIONS[0]; // directly in front
    expect(armorArc(O, facing, attacker)).toBe("front");
  });

  it("a shot from directly behind hits the rear", () => {
    const facing: Direction = 0;
    const attacker = DIRECTIONS[3]; // opposite the facing
    expect(armorArc(O, facing, attacker)).toBe("rear");
  });

  it("oblique shots hit the side", () => {
    const facing: Direction = 0;
    for (const d of [1, 2, 4, 5] as Direction[]) {
      expect(armorArc(O, facing, DIRECTIONS[d])).toBe("side");
    }
  });

  it("rotating the facing rotates the arcs", () => {
    // Facing toward where the attacker stands → that attacker is now front.
    const attacker: Hex = { q: 0, r: 1 }; // direction 5
    expect(armorArc(O, 5, attacker)).toBe("front");
    expect(armorArc(O, 2, attacker)).toBe("rear"); // facing opposite
  });
});

describe("world placement (flat-top)", () => {
  it("origin maps to the world origin; neighbours are one hex-step apart", () => {
    const o = hexToWorld(O, 1);
    expect(o.x).toBeCloseTo(0, 6);
    expect(o.z).toBeCloseTo(0, 6);
    const east = hexToWorld({ q: 1, r: 0 }, 1);
    expect(east.x).toBeCloseTo(1.5, 6); // flat-top column spacing = 1.5 * size
  });

  it("worldToHex inverts hexToWorld (a board click recovers its hex)", () => {
    // Round-trip a spread of hexes through world space and back; the centre, and
    // points jittered around it, must resolve to the same hex (it's what turns a
    // raycast hit into a move target).
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        const h: Hex = { q, r };
        const w = hexToWorld(h, 1);
        expect(worldToHex(w.x, w.z, 1)).toEqual(h);
        // Small offsets toward (but not past) the edge still snap to the centre.
        expect(worldToHex(w.x + 0.2, w.z - 0.2, 1)).toEqual(h);
      }
    }
  });
});
