import { MAX_ENTITIES } from "../config/balance";

// Data-oriented entity store: components are parallel typed arrays (SoA), an
// entity is just an index, and a free-list recycles slots. No per-entity
// objects → cache-friendly, allocation-free in the hot loop. Pure (no THREE),
// so the whole sim is unit-testable in Node without a GPU.

export const KIND_ENEMY = 1;
export const KIND_PROJECTILE = 2;
export const KIND_GEM = 3;

export class World {
  readonly cap: number;
  readonly alive: Uint8Array;
  readonly kind: Uint8Array;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vz: Float32Array;
  readonly hp: Float32Array;
  readonly radius: Float32Array;
  readonly ttl: Float32Array; // seconds remaining (used by projectiles)
  readonly amount: Float32Array; // projectile damage OR gem xp value

  /** Number of live entities (any kind). */
  aliveCount = 0;
  private readonly freeList: number[] = [];

  constructor(cap: number = MAX_ENTITIES) {
    this.cap = cap;
    this.alive = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.px = new Float32Array(cap);
    this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.hp = new Float32Array(cap);
    this.radius = new Float32Array(cap);
    this.ttl = new Float32Array(cap);
    this.amount = new Float32Array(cap);
    // Fill the free list high→low so the first spawns get low indices.
    for (let i = cap - 1; i >= 0; i--) this.freeList.push(i);
  }

  /** Allocate an entity slot; returns its index, or -1 if the pool is full. */
  spawn(): number {
    const id = this.freeList.pop();
    if (id === undefined) return -1;
    this.alive[id] = 1;
    this.aliveCount++;
    return id;
  }

  /** Release an entity slot back to the pool. */
  free(id: number): void {
    if (this.alive[id] === 0) return;
    this.alive[id] = 0;
    this.vx[id] = 0;
    this.vz[id] = 0;
    this.aliveCount--;
    this.freeList.push(id);
  }

  /** Count live entities of a given kind (used by the HUD / tests). */
  countOf(kind: number): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.alive[i] === 1 && this.kind[i] === kind) n++;
    return n;
  }
}
