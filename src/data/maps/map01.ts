import type { Direction, Hex } from "../../sim/hex";
import type { MapCell, MapDef, UnitPlacement } from "../types";

// "Ridge Approach" — the v0 map. A blue force (player support + one AI mech)
// advances west→east to seize an urban zone held by a red detachment, across
// natural rolling terrain. Authored as a FIXED deterministic generation (its own
// internal seed, independent of the run seed) so it's a stable, known map, while
// looking organic rather than a hand-placed grid. Built as data — no sim code
// references this map by name.
//
// Layout uses offset coordinates (col,row) → axial, so the rendered board fills
// a RECTANGLE rather than a sheared parallelogram.

const COLS = 30;
const ROWS = 20;
const MAP_SEED = 0x5eed1a;

/** Offset (col,row) → axial (q,r) for a flat-top rectangular board. */
function offsetToAxial(col: number, row: number): Hex {
  return { q: col, r: row - Math.floor(col / 2) };
}

// ── Seeded value noise + fBm for natural elevation / forest distribution. ──
function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x: number, y: number, seed: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm; // [0,1)
}

const ELEV_AMP = 4.4; // peak elevation units — gentle rolling hills, not mountains
const NOISE_SCALE = 0.15; // lower = broader, smoother landforms
const CONTRAST = 1.4; // mild push toward highs/lows; too high reads as harsh peaks

/** fBm with contrast → a 0..1 landform value with pronounced highs and lows. */
function landform(col: number, row: number): number {
  const e = fbm(col * NOISE_SCALE, row * NOISE_SCALE, MAP_SEED);
  return Math.min(1, Math.max(0, (e - 0.5) * CONTRAST + 0.5));
}

// Handcrafted features sit on top of the natural terrain.
const OBJ_COLS = [22, 23, 24];
const OBJ_ROWS = [8, 9, 10, 11];
const isObjectiveArea = (col: number, row: number) =>
  OBJ_COLS.includes(col) && OBJ_ROWS.includes(row);
const isDeployWest = (col: number) => col <= 2;

function elevationAt(col: number, row: number): number {
  return landform(col, row) * ELEV_AMP;
}

function terrainAt(col: number, row: number): string {
  // Keep deployment lanes and the objective buildable/passable.
  if (isObjectiveArea(col, row)) return "urban";
  const hi = landform(col, row);
  if (isDeployWest(col)) return hi > 0.78 ? "hill" : "open";
  if (hi < 0.14) return "water"; // deepest basins flood (kept modest so land routes remain)
  if (hi > 0.78) return "hill"; // only the highest crests read as hillside
  const forest = fbm(col * 0.22 + 50, row * 0.22 + 50, MAP_SEED ^ 0x1234);
  if (forest > 0.6) return "woods"; // forest stands cluster naturally
  return "open";
}

function buildCells(): MapCell[] {
  const cells: MapCell[] = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      cells.push({ hex: offsetToAxial(col, row), terrain: terrainAt(col, row), elevation: elevationAt(col, row) });
    }
  }
  return cells;
}

const E: Direction = 0; // facing east (toward the objective)
const W: Direction = 3; // facing west (defenders watch the approach)

// Placements authored in offset (col,row) for readability, converted to axial.
const place = (type: string, side: "blue" | "red", col: number, row: number, facing: Direction): UnitPlacement => ({
  type,
  side,
  hex: offsetToAxial(col, row),
  facing,
});

const units: UnitPlacement[] = [
  // Blue: one AI mech (main effort) + the player's support/logistics effort.
  place("mech_assault", "blue", 1, 9, E),
  place("recon", "blue", 2, 5, E),
  place("armor", "blue", 1, 12, E),
  place("infantry", "blue", 0, 7, E),
  place("artillery", "blue", 0, 11, E),
  place("supply", "blue", 0, 9, E),

  // Red: a detachment dug in around the urban objective.
  place("mech_assault", "red", 23, 9, W),
  place("infantry", "red", 22, 8, W),
  place("armor", "red", 24, 11, W),
  place("supply", "red", 26, 10, W),
];

const zone: Hex[] = [
  offsetToAxial(23, 9),
  offsetToAxial(23, 10),
  offsetToAxial(22, 9),
  offsetToAxial(24, 10),
];

export const MAP01: MapDef = {
  name: "Ridge Approach",
  hexSize: 1,
  cells: buildCells(),
  units,
  objective: { kind: "seize", turnLimit: 18, zone, attacker: "blue" },
};
