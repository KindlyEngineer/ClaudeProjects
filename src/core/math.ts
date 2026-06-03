// Small pure math helpers used across sim + render. Kept dependency-free and
// pure so they're trivially unit-testable in Node.

/** Normalize a 2D (XZ) vector. Returns [0,0] for the zero vector. */
export function normalize2(x: number, z: number): [number, number] {
  const len = Math.hypot(x, z);
  if (len === 0) return [0, 0];
  return [x / len, z / len];
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp v to [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
