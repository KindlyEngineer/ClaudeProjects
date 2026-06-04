import { describe, it, expect } from "vitest";
import { mulberry32, range } from "../src/core/rng";
import { normalize2, lerp, clamp } from "../src/core/math";

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces values in [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds diverge", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toEqual(b());
  });

  it("range maps into [min, max)", () => {
    const r = mulberry32(123);
    for (let i = 0; i < 500; i++) {
      const v = range(r, -5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });
});

describe("math", () => {
  it("normalize2 returns a unit vector", () => {
    const [x, z] = normalize2(3, 4);
    expect(Math.hypot(x, z)).toBeCloseTo(1, 6);
    expect(x).toBeCloseTo(0.6, 6);
    expect(z).toBeCloseTo(0.8, 6);
  });

  it("normalize2 handles the zero vector", () => {
    expect(normalize2(0, 0)).toEqual([0, 0]);
  });

  it("lerp interpolates", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 1)).toBe(10);
  });

  it("clamp bounds values", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
