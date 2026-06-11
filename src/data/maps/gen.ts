import type { Direction, Hex } from "../../sim/hex";
import type { MapCell, MapDef, UnitPlacement } from "../types";

// The shared natural-terrain generator (M2): the fBm value-noise approach the
// handcrafted maps use, parametrised so new scenarios and the seeded RANDOM
// SKIRMISH build from one core. Deterministic per seed — a generated map is as
// stable as a handcrafted one.

export function offsetToAxial(col: number, row: number): Hex {
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
export function fbm(x: number, y: number, seed: number): number {
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

export interface GenOpts {
  cols: number;
  rows: number;
  seed: number;
  elevAmp?: number; // default 4.4
  noiseScale?: number; // default 0.15
  contrast?: number; // default 1.4
  /** Reshape the raw landform (e.g. ridge shoulders, river valleys). */
  shape?: (col: number, row: number, base: number) => number;
  /** Override the terrain choice (return undefined to keep the natural rule). */
  terrain?: (col: number, row: number, land: number) => string | undefined;
}

/** Natural rolling cells: deep basins flood, crests read as hillside, forest
 *  stands cluster — the same character as the handcrafted boards. */
export function generateCells(o: GenOpts): MapCell[] {
  const amp = o.elevAmp ?? 4.4;
  const scale = o.noiseScale ?? 0.15;
  const contrast = o.contrast ?? 1.4;
  const land = (col: number, row: number): number => {
    const e = fbm(col * scale, row * scale, o.seed);
    const base = Math.min(1, Math.max(0, (e - 0.5) * contrast + 0.5));
    return o.shape ? Math.min(1, Math.max(0, o.shape(col, row, base))) : base;
  };
  const cells: MapCell[] = [];
  for (let col = 0; col < o.cols; col++) {
    for (let row = 0; row < o.rows; row++) {
      const hi = land(col, row);
      let terrain = o.terrain?.(col, row, hi);
      if (terrain === undefined) {
        if (col <= 2 || col >= o.cols - 3) terrain = hi > 0.78 ? "hill" : "open"; // clean deploy lanes
        else if (hi < 0.13) terrain = "water";
        else if (hi > 0.78) terrain = "hill";
        else terrain = fbm(col * 0.22 + 50, row * 0.22 + 50, o.seed ^ 0x1234) > 0.6 ? "woods" : "open";
      }
      cells.push({ hex: offsetToAxial(col, row), terrain, elevation: hi * amp });
    }
  }
  return cells;
}

export const E: Direction = 0; // east
export const W: Direction = 3; // west

export function place(
  type: string,
  side: "blue" | "red",
  col: number,
  row: number,
  facing: Direction,
  controller: "ai" | "player" = "ai",
): UnitPlacement {
  return { type, side, hex: offsetToAxial(col, row), facing, controller };
}

/** A seeded RANDOM SKIRMISH: a fresh natural 30×20 board each seed, the
 *  canonical forces, a seize objective on the eastern third. Deterministic per
 *  seed, so a good roll is shareable. */
export type ForcePreset = "light" | "standard" | "heavy";

export function randomSkirmishMap(seed: number, preset: ForcePreset = "standard"): MapDef {
  const cols = 30;
  const rows = 20;
  const mapSeed = (Math.imul(seed, 0x9e3779b1) ^ 0x5eed) >>> 0;
  // Objective placement varies with the seed (eastern third, away from edges).
  const objCol = 21 + (mapSeed % 5);
  const objRow = 5 + ((mapSeed >>> 3) % (rows - 10));
  const zoneCells: Array<[number, number]> = [
    [objCol, objRow],
    [objCol + 1, objRow],
    [objCol, objRow + 1],
    [objCol + 1, objRow + 1],
  ];
  const isZone = (c: number, r: number) => zoneCells.some(([zc, zr]) => zc === c && zr === r);
  const cells = generateCells({
    cols,
    rows,
    seed: mapSeed,
    terrain: (c, r) => (isZone(c, r) ? "urban" : undefined),
  });
  const midRow = (rows / 2) | 0;
  const blue: UnitPlacement[] = [
    place("mech_assault", "blue", 1, midRow - 1, E, "ai"),
    place("recon", "blue", 2, midRow - 4, E, "player"),
    place("infantry", "blue", 0, midRow - 2, E, "player"),
    place("artillery", "blue", 0, midRow + 1, E, "player"),
    place("supply", "blue", 0, midRow, E, "player"),
  ];
  const red: UnitPlacement[] = [
    place("mech_assault", "red", objCol + 1, objRow, W),
    place("infantry", "red", objCol - 1, objRow - 1, W),
    place("armor", "red", objCol + 2, objRow + 1, W),
    place("supply", "red", Math.min(cols - 2, objCol + 4), objRow, W),
  ];
  if (preset !== "light") {
    blue.push(
      place("mech_scout", "blue", 1, midRow + 2, E, "ai"),
      place("armor", "blue", 1, midRow + 4, E, "player"),
      place("engineer", "blue", 0, midRow + 3, E, "player"),
    );
    red.push(place("infantry", "red", objCol, objRow + 2, W), place("engineer", "red", objCol, objRow - 2, W));
  }
  if (preset === "heavy") {
    blue.push(place("heavy_tank", "blue", 1, midRow - 3, E, "player"), place("atgm_team", "blue", 2, midRow + 1, E, "player"));
    red.push(
      place("heavy_tank", "red", objCol + 3, objRow - 1, W),
      place("aa_vehicle", "red", Math.min(cols - 2, objCol + 5), objRow + 1, W),
      place("mortar_team", "red", Math.min(cols - 2, objCol + 4), objRow - 2, W),
    );
  }
  const units: UnitPlacement[] = [...blue, ...red];
  return {
    name: `Skirmish ${seed}`,
    hexSize: 1,
    cells,
    units,
    objective: { kind: "seize", turnLimit: 18, zone: zoneCells.map(([c, r]) => offsetToAxial(c, r)), attacker: "blue" },
    commanderSkill: { blue: 1.0, red: 0.7 },
    offmap: { blue: { strike: 1, recon: 1 }, red: { strike: 1, recon: 1 } },
    weather: (["clear", "clear", "rain", "night"] as const)[mapSeed % 4], // seeded sky
  };
}
