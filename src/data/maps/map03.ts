import type { Direction, Hex } from "../../sim/hex";
import type { MapCell, MapDef, UnitPlacement } from "../types";

// "The Gap" — the operation finale: a 36×22 board (the first of the LARGER maps
// — owner direction: map sizes grow with battlefield complexity). Blue must
// BREAK THROUGH a defended corridor between two high ridgelines to the east
// edge, against a deeper red force. Same fixed-seed natural generation as the
// other boards; built as data — no sim code references this map by name.

const COLS = 36;
const ROWS = 22;
const MAP_SEED = 0xca99e;

function offsetToAxial(col: number, row: number): Hex {
  return { q: col, r: row - Math.floor(col / 2) };
}

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
  return sum / norm;
}

const ELEV_AMP = 4.6;
const NOISE_SCALE = 0.13;
const CONTRAST = 1.45;
const MID_ROW = ROWS / 2;

/** Natural landform, then the GAP: ridges pushed up north and south of a
 *  central corridor so the breakthrough axis is a defile between high ground. */
function landform(col: number, row: number): number {
  const e = fbm(col * NOISE_SCALE, row * NOISE_SCALE, MAP_SEED);
  const base = Math.min(1, Math.max(0, (e - 0.5) * CONTRAST + 0.5));
  const offAxis = Math.abs(row - MID_ROW) / MID_ROW; // 0 at the corridor, 1 at the edges
  const ridge = Math.max(0, offAxis - 0.35) * 0.55; // shoulders rise away from the gap
  return Math.min(1, base * 0.75 + ridge);
}

function elevationAt(col: number, row: number): number {
  return landform(col, row) * ELEV_AMP;
}

function terrainAt(col: number, row: number): string {
  if (col <= 2) return landform(col, row) > 0.8 ? "hill" : "open"; // clean deploy lanes
  const hi = landform(col, row);
  if (hi < 0.1) return "water";
  if (hi > 0.74) return "hill";
  const forest = fbm(col * 0.2 + 90, row * 0.2 + 90, MAP_SEED ^ 0x5151);
  if (forest > 0.62) return "woods";
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

const E: Direction = 0;
const W: Direction = 3;

const place = (
  type: string,
  side: "blue" | "red",
  col: number,
  row: number,
  facing: Direction,
  controller: "ai" | "player" = "ai",
): UnitPlacement => ({ type, side, hex: offsetToAxial(col, row), facing, controller });

const units: UnitPlacement[] = [
  // Blue: the full task force — both mechs AI, the support echelon player-run.
  place("mech_assault", "blue", 1, 10, E, "ai"),
  place("mech_scout", "blue", 1, 13, E, "ai"),
  place("recon", "blue", 2, 8, E, "player"),
  place("armor", "blue", 1, 15, E, "player"),
  place("infantry", "blue", 0, 9, E, "player"),
  place("engineer", "blue", 0, 14, E, "player"),
  place("artillery", "blue", 0, 12, E, "player"),
  place("supply", "blue", 0, 11, E, "player"),

  // Red: a deep, layered defence of the gap — screen, gun line, and a reserve.
  place("recon", "red", 22, 11, W),
  place("infantry", "red", 25, 9, W),
  place("infantry", "red", 26, 13, W),
  place("engineer", "red", 26, 11, W),
  place("armor", "red", 28, 10, W),
  place("mech_assault", "red", 29, 12, W),
  place("aa_vehicle", "red", 30, 10, W), // contests blue's air over the gap (M2.5)
  place("artillery", "red", 32, 11, W),
  place("supply", "red", 33, 12, W),
];

const exitEdge: Hex[] = [];
for (let row = 0; row < ROWS; row++) exitEdge.push(offsetToAxial(COLS - 1, row));

export const MAP03: MapDef = {
  name: "The Gap",
  hexSize: 1,
  cells: buildCells(),
  units,
  objective: { kind: "breakthrough", turnLimit: 20, zone: exitEdge, attacker: "blue" },
  commanderSkill: { blue: 1.0, red: 0.7 },
  offmap: { blue: { strike: 1, recon: 1 }, red: { strike: 1, recon: 0 } },
};
