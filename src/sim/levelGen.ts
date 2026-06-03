import { CHUNK_GRID, CHUNK_SIZE } from "../config/balance";
import type { ThemeDef } from "../config/runConfig";
import { mulberry32 } from "../core/rng";
import { Level, TILE_COVER, TILE_FLOOR, TILE_HAZARD, TILE_WALL } from "./level";

// Levels are assembled from pre-made 8×8 chunk templates. Every template keeps
// its OUTER RING as floor, so adjacent chunks always connect — the whole arena
// is guaranteed traversable without runtime path-carving, while chunk interiors
// supply the blocking geometry and hazards. '.' floor, '#' wall, 'o' cover,
// '~' hazard.

const CHUNKS: Record<string, string[]> = {
  open: [
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
  ],
  pillars: [
    "........",
    "..#..#..",
    "........",
    "........",
    "..#..#..",
    "........",
    "........",
    "........",
  ],
  barrier: [
    "........",
    "........",
    ".####...",
    "........",
    "...####.",
    "........",
    "........",
    "........",
  ],
  crates: [
    "........",
    "........",
    "...oo...",
    "...oo...",
    "........",
    "..o..o..",
    "........",
    "........",
  ],
  hazard: [
    "........",
    "........",
    "........",
    "..~~~~..",
    "..~~~~..",
    "........",
    "........",
    "........",
  ],
  elbow: [
    "........",
    "..####..",
    "..#.....",
    "..#.....",
    "..#.....",
    "........",
    "........",
    "........",
  ],
};

function charToTile(c: string): number {
  switch (c) {
    case "#":
      return TILE_WALL;
    case "o":
      return TILE_COVER;
    case "~":
      return TILE_HAZARD;
    default:
      return TILE_FLOOR;
  }
}

/** Build a seeded arena for a theme: assemble chunks, force an open centre,
 *  wall the border. Deterministic per seed. */
export function generateLevel(seed: number, theme: ThemeDef): Level {
  const cols = CHUNK_GRID * CHUNK_SIZE;
  const rows = CHUNK_GRID * CHUNK_SIZE;
  const level = new Level(cols, rows);
  const rng = mulberry32(seed ^ 0x51ed270b);

  // Weighted bag of chunk names ('open' boosted by the theme's openBias).
  const bag: string[] = [];
  for (const name of theme.chunks) {
    const weight = name === "open" ? theme.openBias : 1;
    for (let i = 0; i < weight; i++) bag.push(name);
  }
  const mid = CHUNK_GRID / 2;

  for (let gz = 0; gz < CHUNK_GRID; gz++) {
    for (let gx = 0; gx < CHUNK_GRID; gx++) {
      // Keep the four central chunks open — a clear plaza to spawn and kite in.
      const central = (gx === mid - 1 || gx === mid) && (gz === mid - 1 || gz === mid);
      const name = central ? "open" : bag[(rng() * bag.length) | 0];
      const tmpl = CHUNKS[name] ?? CHUNKS.open;
      for (let r = 0; r < CHUNK_SIZE; r++) {
        const line = tmpl[r];
        for (let c = 0; c < CHUNK_SIZE; c++) {
          level.setCell(gx * CHUNK_SIZE + c, gz * CHUNK_SIZE + r, charToTile(line[c]));
        }
      }
    }
  }

  // Solid border wall to contain the arena.
  for (let cx = 0; cx < cols; cx++) {
    level.setCell(cx, 0, TILE_WALL);
    level.setCell(cx, rows - 1, TILE_WALL);
  }
  for (let cz = 0; cz < rows; cz++) {
    level.setCell(0, cz, TILE_WALL);
    level.setCell(cols - 1, cz, TILE_WALL);
  }
  return level;
}

/** Nearest pathable (floor) world position to (x,z), spiralling outward. */
export function snapToFloor(level: Level, x: number, z: number): { x: number; z: number } {
  const cx = level.cellX(x);
  const cz = level.cellZ(z);
  if (level.isPathable(cx, cz)) return { x: level.worldX(cx), z: level.worldZ(cz) };
  for (let r = 1; r < Math.max(level.cols, level.rows); r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (level.isPathable(cx + dx, cz + dz)) {
          return { x: level.worldX(cx + dx), z: level.worldZ(cz + dz) };
        }
      }
    }
  }
  return { x, z };
}
