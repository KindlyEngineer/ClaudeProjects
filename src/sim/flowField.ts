import { Level } from "./level";

// Grid flow-field pathing for the horde. A BFS from the player's cell over
// pathable (floor) tiles produces a distance field; each cell then stores a
// unit vector toward its lowest-distance neighbour. Enemies just sample the
// vector under them and flow toward the player around walls and gaps — one BFS
// per rebuild handles thousands of enemies cheaply. 8-connected, but diagonals
// are blocked when they'd cut a wall corner.

const UNREACHED = -1;

export class FlowField {
  readonly cols: number;
  readonly rows: number;
  private readonly dist: Int32Array;
  private readonly dirX: Float32Array;
  private readonly dirZ: Float32Array;
  private readonly queue: Int32Array;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.dist = new Int32Array(n);
    this.dirX = new Float32Array(n);
    this.dirZ = new Float32Array(n);
    this.queue = new Int32Array(n);
  }

  /** Rebuild the field with the player's cell as the goal. */
  rebuild(level: Level, targetCx: number, targetCz: number): void {
    const { cols, rows, dist } = this;
    dist.fill(UNREACHED);
    this.dirX.fill(0);
    this.dirZ.fill(0);
    if (!level.isPathable(targetCx, targetCz)) return;

    const q = this.queue;
    let head = 0;
    let tail = 0;
    const start = targetCz * cols + targetCx;
    dist[start] = 0;
    q[tail++] = start;

    while (head < tail) {
      const cur = q[head++];
      const cx = cur % cols;
      const cz = (cur / cols) | 0;
      const nd = dist[cur] + 1;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          if (!level.isPathable(nx, nz)) continue;
          // No corner-cutting through solid diagonals.
          if (dx !== 0 && dz !== 0) {
            if (!level.isPathable(cx + dx, cz) || !level.isPathable(cx, cz + dz)) continue;
          }
          const ni = nz * cols + nx;
          if (dist[ni] === UNREACHED) {
            dist[ni] = nd;
            q[tail++] = ni;
          }
        }
      }
    }

    // Derive per-cell flow toward the lowest-distance neighbour.
    for (let cz = 0; cz < rows; cz++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cz * cols + cx;
        if (dist[i] === UNREACHED || dist[i] === 0) continue;
        let bestD = dist[i];
        let bx = 0;
        let bz = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
            const nd = dist[nz * cols + nx];
            if (nd !== UNREACHED && nd < bestD) {
              bestD = nd;
              bx = dx;
              bz = dz;
            }
          }
        }
        const len = Math.hypot(bx, bz) || 1;
        this.dirX[i] = bx / len;
        this.dirZ[i] = bz / len;
      }
    }
  }

  /** Flow direction at a cell, or {0,0} if unreachable/at goal. */
  sampleCell(cx: number, cz: number): { fx: number; fz: number } {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return { fx: 0, fz: 0 };
    const i = cz * this.cols + cx;
    return { fx: this.dirX[i], fz: this.dirZ[i] };
  }
}
