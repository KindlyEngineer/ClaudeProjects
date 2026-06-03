// Uniform-grid spatial hash for broadphase queries (enemy separation, projectile
// hits, contact damage). Rebuilt each tick — cheap for roughly uniform density.
// Keys pack signed cell coords into one integer; coords are assumed within the
// arena bounds (|cell| < 32768), which holds for our play space.

const BIAS = 1 << 15; // 32768

export class SpatialHash {
  private readonly inv: number;
  private readonly buckets = new Map<number, number[]>();

  constructor(cellSize: number) {
    this.inv = 1 / cellSize;
  }

  private cellKey(cx: number, cz: number): number {
    return ((cx + BIAS) << 16) | (cz + BIAS);
  }

  clear(): void {
    this.buckets.clear();
  }

  insert(id: number, x: number, z: number): void {
    const key = this.cellKey(Math.floor(x * this.inv), Math.floor(z * this.inv));
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(id);
    else this.buckets.set(key, [id]);
  }

  /** Invoke `cb` for every id in the 3×3 cell block around (x, z). */
  forEachNear(x: number, z: number, cb: (id: number) => void): void {
    const cx = Math.floor(x * this.inv);
    const cz = Math.floor(z * this.inv);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.buckets.get(this.cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) cb(bucket[i]);
      }
    }
  }
}
