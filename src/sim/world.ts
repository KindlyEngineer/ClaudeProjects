import { MAX_ENTITIES } from "../config/balance";

// Data-oriented entity store: components are parallel typed arrays (SoA), an
// entity is just an index, and a free-list recycles slots. No per-entity
// objects → cache-friendly, allocation-free in the hot loop. Pure (no THREE),
// so the whole sim is unit-testable in Node without a GPU.

export const KIND_ENEMY = 1;
export const KIND_PROJECTILE = 2;
export const KIND_GEM = 3;
export const KIND_ORBITER = 4; // aura blade circling the player (orbit weapon)

// Enemy variants (stored in `variant`).
export const VARIANT_GRUNT = 0;
export const VARIANT_BOSS = 1;

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
  readonly kx: Float32Array; // knockback velocity (enemies)
  readonly kz: Float32Array;
  readonly maxhp: Float32Array; // spawn HP (enemy health-bar render)
  readonly pierce: Float32Array; // projectile: enemies it can still punch through
  readonly kb: Float32Array; // projectile: knockback impulse imparted on hit
  readonly area: Float32Array; // projectile: explosion radius (lobber); 0 = none
  readonly angle: Float32Array; // orbiter: current orbital angle (radians)
  readonly wkind: Uint8Array; // projectile/orbiter: weapon archetype id (render + behaviour)
  readonly variant: Uint8Array; // enemy: VARIANT_GRUNT / VARIANT_BOSS

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
    this.kx = new Float32Array(cap);
    this.kz = new Float32Array(cap);
    this.maxhp = new Float32Array(cap);
    this.pierce = new Float32Array(cap);
    this.kb = new Float32Array(cap);
    this.area = new Float32Array(cap);
    this.angle = new Float32Array(cap);
    this.wkind = new Uint8Array(cap);
    this.variant = new Uint8Array(cap);
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
    this.kx[id] = 0;
    this.kz[id] = 0;
    this.pierce[id] = 0;
    this.kb[id] = 0;
    this.area[id] = 0;
    this.angle[id] = 0;
    this.wkind[id] = 0;
    this.variant[id] = 0;
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
