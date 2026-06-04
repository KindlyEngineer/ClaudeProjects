import { CHUNK_GRID, CHUNK_SIZE } from "../config/balance";
import type { ThemeDef } from "../config/runConfig";
import { mulberry32 } from "../core/rng";
import { Level, TILE_COVER, TILE_FLOOR, TILE_HAZARD, TILE_WALL } from "./level";

// Levels are assembled from pre-made 8×8 chunk templates. Every template keeps
// its OUTER RING as floor, so adjacent chunks always connect — the whole arena
// is guaranteed traversable without runtime path-carving.
//
// Chunks carry a density rating (0–3). The assembler enforces adjacency rules:
// medium/dense chunks (density ≥ 2) never sit next to each other, and density-3
// chunks are globally capped. Each chunk is randomly rotated 0/90/180/270° for
// variety (rotation preserves the open-border invariant).

interface ChunkDef {
  density: number; // 0=empty, 1=sparse, 2=medium, 3=dense
  template: string[];
}

// '.' floor, '#' wall, 'o' cover, '~' hazard.  Outer ring must be all '.'.
const CHUNK_DEFS: Record<string, ChunkDef> = {
  // ── density 0 (empty) ───────────────────────────────────
  open: {
    density: 0,
    template: [
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
    ],
  },

  // ── density 1 (sparse — 1–2 small isolated features) ───
  scatter: {
    density: 1,
    template: [
      "........",
      "........",
      "..#.....",
      "........",
      "........",
      ".....#..",
      "........",
      "........",
    ],
  },
  cover_pair: {
    density: 1,
    template: [
      "........",
      "........",
      "........",
      "..o..o..",
      "........",
      "........",
      "........",
      "........",
    ],
  },

  // ── density 2 (medium — one clear tactical structure) ───
  pillars: {
    density: 2,
    template: [
      "........",
      "..#..#..",
      "........",
      "........",
      "........",
      "..#..#..",
      "........",
      "........",
    ],
  },
  barrier: {
    density: 2,
    template: [
      "........",
      "........",
      "..###...",
      "........",
      "........",
      "........",
      "........",
      "........",
    ],
  },
  crates: {
    density: 2,
    template: [
      "........",
      "........",
      "..oo....",
      "........",
      "........",
      "....oo..",
      "........",
      "........",
    ],
  },
  hazard: {
    density: 2,
    template: [
      "........",
      "........",
      "........",
      "...~~...",
      "...~~...",
      "........",
      "........",
      "........",
    ],
  },
  elbow: {
    density: 2,
    template: [
      "........",
      "..##....",
      "..#.....",
      "........",
      "........",
      "........",
      "........",
      "........",
    ],
  },

  // ── density 3 (dense — significant geometry, capped) ────
  bunker: {
    density: 3,
    template: [
      "........",
      "..####..",
      "..#.....",
      "..#.....",
      "..####..",
      "........",
      "........",
      "........",
    ],
  },
  corridor: {
    density: 3,
    template: [
      "........",
      ".###....",
      "........",
      "........",
      "........",
      "....###.",
      "........",
      "........",
    ],
  },
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

function rotateTemplate(tmpl: string[]): string[] {
  const n = tmpl.length;
  const out: string[] = [];
  for (let c = 0; c < n; c++) {
    let row = "";
    for (let r = n - 1; r >= 0; r--) row += tmpl[r][c];
    out.push(row);
  }
  return out;
}

const MAX_DENSE = 3;

/** Build a seeded arena for a theme: assemble chunks with adjacency-aware
 *  density rules, force an open centre, wall the border. Deterministic per seed. */
export function generateLevel(seed: number, theme: ThemeDef): Level {
  const cols = CHUNK_GRID * CHUNK_SIZE;
  const rows = CHUNK_GRID * CHUNK_SIZE;
  const level = new Level(cols, rows);
  const rng = mulberry32(seed ^ 0x51ed270b);

  const bag: string[] = [];
  for (const name of theme.chunks) {
    if (!CHUNK_DEFS[name]) continue;
    const weight = name === "open" ? theme.openBias : 1;
    for (let i = 0; i < weight; i++) bag.push(name);
  }

  const mid = CHUNK_GRID / 2;
  const densityGrid = new Uint8Array(CHUNK_GRID * CHUNK_GRID);
  let denseCount = 0;

  for (let gz = 0; gz < CHUNK_GRID; gz++) {
    for (let gx = 0; gx < CHUNK_GRID; gx++) {
      const idx = gz * CHUNK_GRID + gx;
      const central =
        (gx === mid - 1 || gx === mid) && (gz === mid - 1 || gz === mid);

      let name: string;
      if (central) {
        name = "open";
      } else {
        let maxDensity = 3;
        if (gx > 0) {
          const leftD = densityGrid[gz * CHUNK_GRID + (gx - 1)];
          if (leftD >= 2) maxDensity = Math.min(maxDensity, 1);
        }
        if (gz > 0) {
          const topD = densityGrid[(gz - 1) * CHUNK_GRID + gx];
          if (topD >= 2) maxDensity = Math.min(maxDensity, 1);
        }
        if (denseCount >= MAX_DENSE) maxDensity = Math.min(maxDensity, 2);

        const allowed = bag.filter(
          (n) => (CHUNK_DEFS[n]?.density ?? 0) <= maxDensity,
        );
        name =
          allowed.length > 0
            ? allowed[(rng() * allowed.length) | 0]
            : "open";
      }

      const def = CHUNK_DEFS[name] ?? CHUNK_DEFS.open;
      densityGrid[idx] = def.density;
      if (def.density >= 3) denseCount++;

      let tmpl = def.template;
      const rotations = (rng() * 4) | 0;
      for (let i = 0; i < rotations; i++) tmpl = rotateTemplate(tmpl);

      for (let r = 0; r < CHUNK_SIZE; r++) {
        const line = tmpl[r];
        for (let c = 0; c < CHUNK_SIZE; c++) {
          level.setCell(
            gx * CHUNK_SIZE + c,
            gz * CHUNK_SIZE + r,
            charToTile(line[c]),
          );
        }
      }
    }
  }

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
export function snapToFloor(
  level: Level,
  x: number,
  z: number,
): { x: number; z: number } {
  const cx = level.cellX(x);
  const cz = level.cellZ(z);
  if (level.isPathable(cx, cz))
    return { x: level.worldX(cx), z: level.worldZ(cz) };
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
