// Seeded pseudo-random number generator (mulberry32). Deterministic from a seed
// so runs are reproducible — essential for seeded-procedural terrain and for
// screenshot/regression verification.

export type Rng = () => number;

/** Returns a deterministic RNG producing floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Float in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** One pure mulberry32 step: given a 32-bit state, return the next draw and the
 *  state to carry forward. Lets the sim keep its RNG position in plain data
 *  (`GameState.rngState`) so a match is fully reproducible and serializable. */
export function mulberry32Step(s: number): { value: number; next: number } {
  const a = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: a };
}
