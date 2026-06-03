import { PIT_LEVEL } from "../config/balance";
import type { ThemeDef } from "../config/runConfig";
import { mulberry32 } from "../core/rng";

// Continuous heightmap terrain — the heart of the verticality differentiator.
// Pure math (no THREE) so every rule (height, slope, pit, high-ground) is
// unit-testable headlessly. Seeded → deterministic per run. Generation is
// fractal value-noise plus handcrafted POIs (a central plateau + lethal pits).

interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 1 at center → 0 at the rim (t in [0,1]); flat-ish near the middle. */
function falloff(t: number): number {
  if (t >= 1) return 0;
  return 1 - smooth(t);
}

/** Deterministic hash of an integer lattice point → [0, 1). */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
}

export class Terrain {
  private readonly amplitude: number;
  private readonly frequency: number;
  private readonly octaves: number;
  private readonly plateau: number;
  private readonly plateauR: number;
  private readonly craters: Crater[] = [];
  private readonly seed: number;

  constructor(seed: number, theme: ThemeDef["terrain"], arenaRadius: number) {
    this.seed = seed >>> 0;
    this.amplitude = theme.amplitude;
    this.frequency = theme.frequency;
    this.octaves = theme.octaves;
    this.plateau = theme.plateau;
    this.plateauR = arenaRadius * 0.2;

    // Handcrafted POIs: pits placed by seeded RNG in the mid-ring, deep enough
    // that their floors fall below PIT_LEVEL (instant-death zones).
    const rng = mulberry32(this.seed ^ 0x9e3779b9);
    for (let i = 0; i < theme.pits; i++) {
      const a = rng() * Math.PI * 2;
      const d = arenaRadius * (0.32 + rng() * 0.42);
      this.craters.push({
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        r: 4.5 + rng() * 2.5,
        depth: this.amplitude + 12,
      });
    }
  }

  private fbm(x: number, z: number): number {
    let amp = 1;
    let freq = this.frequency;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < this.octaves; o++) {
      const px = x * freq;
      const pz = z * freq;
      const x0 = Math.floor(px);
      const z0 = Math.floor(pz);
      const sx = smooth(px - x0);
      const sz = smooth(pz - z0);
      const n00 = hash2(x0, z0, this.seed);
      const n10 = hash2(x0 + 1, z0, this.seed);
      const n01 = hash2(x0, z0 + 1, this.seed);
      const n11 = hash2(x0 + 1, z0 + 1, this.seed);
      const nx0 = n00 + (n10 - n00) * sx;
      const nx1 = n01 + (n11 - n01) * sx;
      sum += amp * (nx0 + (nx1 - nx0) * sz);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm; // [0,1)
  }

  /** World height (Y) at ground position (x, z). */
  heightAt(x: number, z: number): number {
    let h = this.amplitude * this.fbm(x, z);
    const pd = Math.hypot(x, z);
    h += this.plateau * falloff(pd / this.plateauR);
    for (const c of this.craters) {
      const d = Math.hypot(x - c.x, z - c.z);
      h -= c.depth * falloff(d / c.r);
    }
    return h;
  }

  /** Lethal pit test. */
  isPit(x: number, z: number): boolean {
    return this.heightAt(x, z) <= PIT_LEVEL;
  }

  /** Uphill gradient (∂h/∂x, ∂h/∂z) via central differences. */
  gradient(x: number, z: number): { gx: number; gz: number } {
    const e = 0.5;
    const gx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const gz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return { gx, gz };
  }
}
