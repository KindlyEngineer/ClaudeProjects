import { CELL } from "../config/balance";

// A tile-grid arena. The floor is flat and walkable; WALL/COVER tiles are solid
// (block movement, projectiles and line of sight); HAZARD tiles are walkable but
// lethal. Pure data + queries (no THREE) so all of it is unit-testable. The grid
// is centred on the world origin.

export const TILE_FLOOR = 0;
export const TILE_WALL = 1;
export const TILE_COVER = 2;
export const TILE_HAZARD = 3;

export class Level {
  readonly cols: number;
  readonly rows: number;
  readonly tiles: Uint8Array;
  /** World coordinate of the grid's min corner (cell 0,0). */
  readonly originX: number;
  readonly originZ: number;

  constructor(cols: number, rows: number, tiles?: Uint8Array) {
    this.cols = cols;
    this.rows = rows;
    this.tiles = tiles ?? new Uint8Array(cols * rows);
    this.originX = -(cols * CELL) / 2;
    this.originZ = -(rows * CELL) / 2;
  }

  cellX(x: number): number {
    return Math.floor((x - this.originX) / CELL);
  }
  cellZ(z: number): number {
    return Math.floor((z - this.originZ) / CELL);
  }
  /** World-space centre of a cell. */
  worldX(cx: number): number {
    return this.originX + (cx + 0.5) * CELL;
  }
  worldZ(cz: number): number {
    return this.originZ + (cz + 0.5) * CELL;
  }
  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.cols && cz < this.rows;
  }

  tileAtCell(cx: number, cz: number): number {
    if (!this.inBounds(cx, cz)) return TILE_WALL; // outside the grid is solid
    return this.tiles[cz * this.cols + cx];
  }
  setCell(cx: number, cz: number, t: number): void {
    if (this.inBounds(cx, cz)) this.tiles[cz * this.cols + cx] = t;
  }
  tileAt(x: number, z: number): number {
    return this.tileAtCell(this.cellX(x), this.cellZ(z));
  }

  /** Solid geometry: blocks both movement and projectiles. */
  blocksAtCell(cx: number, cz: number): boolean {
    const t = this.tileAtCell(cx, cz);
    return t === TILE_WALL || t === TILE_COVER;
  }
  blocksMovement(x: number, z: number): boolean {
    return this.blocksAtCell(this.cellX(x), this.cellZ(z));
  }
  blocksProjectile(x: number, z: number): boolean {
    return this.blocksMovement(x, z);
  }
  isHazard(x: number, z: number): boolean {
    return this.tileAt(x, z) === TILE_HAZARD;
  }
  /** Floor only — where enemies are allowed to path (avoids cover & hazards). */
  isPathable(cx: number, cz: number): boolean {
    return this.tileAtCell(cx, cz) === TILE_FLOOR;
  }

  /** True if nothing solid sits on the segment (x0,z0)→(x1,z1). */
  hasLineOfSight(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / (CELL * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.blocksProjectile(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }
}
