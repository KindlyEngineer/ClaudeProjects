// Hex grid geometry — pure, deterministic, no rendering. Axial coordinates
// (q, r) with a cube projection for distance. Flat-top orientation: the six
// neighbour directions are indexed 0..5 and double as unit *facings*.
//
// This is the spine of the sim: movement, range, line-drawing (for LOS later)
// and the facing/armour-arc model all build on these functions.

export interface Hex {
  readonly q: number;
  readonly r: number;
}

/** A facing or neighbour direction, 0..5. Also used as a unit's facing. */
export type Direction = 0 | 1 | 2 | 3 | 4 | 5;

export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

/** The neighbour of `h` in direction `d`. */
export function neighbor(h: Hex, d: Direction): Hex {
  return hexAdd(h, DIRECTIONS[d]);
}

export function neighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((dir) => hexAdd(h, dir));
}

// Cube coordinates (x + y + z === 0) — used for distance and rounding.
function toCube(h: Hex): { x: number; y: number; z: number } {
  const x = h.q;
  const z = h.r;
  return { x, y: -x - z, z };
}

/** Grid distance in hexes. */
export function hexDistance(a: Hex, b: Hex): number {
  const ac = toCube(a);
  const bc = toCube(b);
  return (Math.abs(ac.x - bc.x) + Math.abs(ac.y - bc.y) + Math.abs(ac.z - bc.z)) / 2;
}

function cubeRound(x: number, y: number, z: number): Hex {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

/** Hexes along the line from `a` to `b` inclusive (for line-of-sight sampling). */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  if (n === 0) return [a];
  const ac = toCube(a);
  const bc = toCube(b);
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(
      cubeRound(
        ac.x + (bc.x - ac.x) * t,
        ac.y + (bc.y - ac.y) * t,
        ac.z + (bc.z - ac.z) * t,
      ),
    );
  }
  return out;
}

/** The direction index (0..5) that best points from `a` toward `b`. */
export function directionTo(a: Hex, b: Hex): Direction {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  // Compare against the six unit directions using the cube angle; cheapest is
  // to pick the direction with the greatest dot product in cube space.
  let best: Direction = 0;
  let bestDot = -Infinity;
  for (let d = 0; d < 6; d++) {
    const dir = DIRECTIONS[d];
    const dot = dq * dir.q + dr * dir.r + (-dq - dr) * (-dir.q - dir.r);
    if (dot > bestDot) {
      bestDot = dot;
      best = d as Direction;
    }
  }
  return best;
}

export type Arc = "front" | "side" | "rear";

/** Armour arc a shot from `attacker` strikes on a `target` facing `facing`.
 *  Relative sector 0 = front (the faced edge), 3 = rear, the rest = side. */
export function armorArc(target: Hex, facing: Direction, attacker: Hex): Arc {
  const incoming = directionTo(target, attacker);
  const rel = (incoming - facing + 6) % 6;
  if (rel === 0) return "front";
  if (rel === 3) return "rear";
  return "side";
}

// ── World placement (flat-top) — render reads these; sim never needs XЗ. ──
const SQRT3 = Math.sqrt(3);

/** Centre of a hex on the XZ plane, given hex circumradius `size`. */
export function hexToWorld(h: Hex, size: number): { x: number; z: number } {
  return {
    x: size * 1.5 * h.q,
    z: size * SQRT3 * (h.r + h.q / 2),
  };
}

/** The six corner offsets (XZ) of a flat-top hex of circumradius `size`. */
export function hexCorners(size: number): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    out.push({ x: size * Math.cos(angle), z: size * Math.sin(angle) });
  }
  return out;
}
