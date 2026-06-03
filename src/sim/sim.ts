import {
  ENEMY_CONTACT_DPS,
  ENEMY_HP,
  ENEMY_RADIUS,
  ENEMY_SEPARATION,
  ENEMY_SPEED,
  GEM_MAGNET_RADIUS,
  GEM_MAGNET_SPEED,
  GEM_VALUE,
  PLAYER_MAX_HP,
  PLAYER_PICKUP_RADIUS,
  PLAYER_SPEED,
  PROJECTILE_DAMAGE,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_TTL,
  SPAWN_BATCH,
  SPAWN_INTERVAL_MIN,
  SPAWN_INTERVAL_START,
  SPAWN_RAMP_SEC,
  SPAWN_RING_RADIUS,
  WEAPON_COOLDOWN,
  WEAPON_RANGE,
  XP_BASE_PER_LEVEL,
} from "../config/balance";
import { clamp, lerp, normalize2 } from "../core/math";
import { mulberry32, type Rng } from "../core/rng";
import { SpatialHash } from "./spatialHash";
import { KIND_ENEMY, KIND_GEM, KIND_PROJECTILE, World } from "./world";

export interface InputState {
  x: number;
  z: number;
}

const PLAYER_RADIUS = 0.5;
const HASH_CELL = 2;

// The whole game simulation: pure typed-array state advanced by a fixed step.
// Deterministic given a seed, so runs/screenshots are reproducible and every
// system below is verifiable in headless Vitest.
export class Sim {
  readonly world = new World();
  private readonly hash = new SpatialHash(HASH_CELL);
  private readonly rng: Rng;

  time = 0;

  // Player sim state (prev kept for render interpolation).
  playerX = 0;
  playerZ = 0;
  playerPrevX = 0;
  playerPrevZ = 0;
  playerHp = PLAYER_MAX_HP;

  // Run stats.
  xp = 0;
  level = 1;
  kills = 0;

  private spawnTimer = 0;
  private fireTimer = 0;

  constructor(seed: number = 1) {
    this.rng = mulberry32(seed);
  }

  /** XP needed to reach the next level. */
  xpForNextLevel(): number {
    return this.level * XP_BASE_PER_LEVEL;
  }

  update(dt: number, input: InputState): void {
    this.time += dt;
    this.movePlayer(dt, input);
    this.spawnEnemies(dt);
    this.rebuildEnemyHash();
    this.updateEnemies(dt);
    this.fireWeapon(dt);
    this.updateProjectiles(dt);
    this.updateGems(dt);
    this.applyLeveling();
    this.applyContactDamage(dt);
  }

  private movePlayer(dt: number, input: InputState): void {
    this.playerPrevX = this.playerX;
    this.playerPrevZ = this.playerZ;
    this.playerX += input.x * PLAYER_SPEED * dt;
    this.playerZ += input.z * PLAYER_SPEED * dt;
  }

  private spawnEnemies(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const t = clamp(this.time / SPAWN_RAMP_SEC, 0, 1);
    this.spawnTimer += lerp(SPAWN_INTERVAL_START, SPAWN_INTERVAL_MIN, t);
    for (let n = 0; n < SPAWN_BATCH; n++) {
      const id = this.world.spawn();
      if (id < 0) return;
      const a = this.rng() * Math.PI * 2;
      const w = this.world;
      w.kind[id] = KIND_ENEMY;
      w.px[id] = this.playerX + Math.cos(a) * SPAWN_RING_RADIUS;
      w.pz[id] = this.playerZ + Math.sin(a) * SPAWN_RING_RADIUS;
      w.vx[id] = 0;
      w.vz[id] = 0;
      w.hp[id] = ENEMY_HP;
      w.radius[id] = ENEMY_RADIUS;
    }
  }

  private rebuildEnemyHash(): void {
    const w = this.world;
    this.hash.clear();
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] === 1 && w.kind[i] === KIND_ENEMY) this.hash.insert(i, w.px[i], w.pz[i]);
    }
  }

  private updateEnemies(dt: number): void {
    const w = this.world;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_ENEMY) continue;
      // Steer toward the player.
      let [dirX, dirZ] = normalize2(this.playerX - w.px[i], this.playerZ - w.pz[i]);
      // Soft separation from nearby enemies so the swarm spreads out.
      let sepX = 0;
      let sepZ = 0;
      const xi = w.px[i];
      const zi = w.pz[i];
      this.hash.forEachNear(xi, zi, (j) => {
        if (j === i) return;
        const ddx = xi - w.px[j];
        const ddz = zi - w.pz[j];
        const d2 = ddx * ddx + ddz * ddz;
        const min = ENEMY_RADIUS * 2;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2);
          sepX += ddx / d;
          sepZ += ddz / d;
        }
      });
      dirX += sepX * ENEMY_SEPARATION;
      dirZ += sepZ * ENEMY_SEPARATION;
      [dirX, dirZ] = normalize2(dirX, dirZ);
      w.vx[i] = dirX * ENEMY_SPEED;
      w.vz[i] = dirZ * ENEMY_SPEED;
      w.px[i] += w.vx[i] * dt;
      w.pz[i] += w.vz[i] * dt;
    }
  }

  /** Nearest live enemy to the player within range, or -1. */
  private nearestEnemy(): number {
    const w = this.world;
    let best = -1;
    let bestD2 = WEAPON_RANGE * WEAPON_RANGE;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_ENEMY) continue;
      const dx = w.px[i] - this.playerX;
      const dz = w.pz[i] - this.playerZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }

  private fireWeapon(dt: number): void {
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    const target = this.nearestEnemy();
    if (target < 0) return;
    this.fireTimer += WEAPON_COOLDOWN;
    const w = this.world;
    const [dx, dz] = normalize2(w.px[target] - this.playerX, w.pz[target] - this.playerZ);
    const id = w.spawn();
    if (id < 0) return;
    w.kind[id] = KIND_PROJECTILE;
    w.px[id] = this.playerX;
    w.pz[id] = this.playerZ;
    w.vx[id] = dx * PROJECTILE_SPEED;
    w.vz[id] = dz * PROJECTILE_SPEED;
    w.ttl[id] = PROJECTILE_TTL;
    w.radius[id] = PROJECTILE_RADIUS;
    w.amount[id] = PROJECTILE_DAMAGE;
  }

  private updateProjectiles(dt: number): void {
    const w = this.world;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_PROJECTILE) continue;
      w.ttl[i] -= dt;
      if (w.ttl[i] <= 0) {
        w.free(i);
        continue;
      }
      w.px[i] += w.vx[i] * dt;
      w.pz[i] += w.vz[i] * dt;
      // Hit-test against nearby enemies.
      let hit = -1;
      const reach = w.radius[i] + ENEMY_RADIUS;
      const xi = w.px[i];
      const zi = w.pz[i];
      this.hash.forEachNear(xi, zi, (j) => {
        if (hit >= 0 || w.alive[j] !== 1 || w.kind[j] !== KIND_ENEMY) return;
        const dx = xi - w.px[j];
        const dz = zi - w.pz[j];
        if (dx * dx + dz * dz <= reach * reach) hit = j;
      });
      if (hit >= 0) {
        w.hp[hit] -= w.amount[i];
        w.free(i);
        if (w.hp[hit] <= 0) this.killEnemy(hit);
      }
    }
  }

  private killEnemy(id: number): void {
    const w = this.world;
    const ex = w.px[id];
    const ez = w.pz[id];
    w.free(id);
    this.kills++;
    const gem = w.spawn();
    if (gem < 0) return;
    w.kind[gem] = KIND_GEM;
    w.px[gem] = ex;
    w.pz[gem] = ez;
    w.vx[gem] = 0;
    w.vz[gem] = 0;
    w.amount[gem] = GEM_VALUE;
  }

  private updateGems(dt: number): void {
    const w = this.world;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_GEM) continue;
      const dx = this.playerX - w.px[i];
      const dz = this.playerZ - w.pz[i];
      const d = Math.hypot(dx, dz);
      if (d <= PLAYER_PICKUP_RADIUS) {
        this.xp += w.amount[i];
        w.free(i);
        continue;
      }
      if (d <= GEM_MAGNET_RADIUS && d > 0) {
        w.px[i] += (dx / d) * GEM_MAGNET_SPEED * dt;
        w.pz[i] += (dz / d) * GEM_MAGNET_SPEED * dt;
      }
    }
  }

  private applyLeveling(): void {
    let need = this.xpForNextLevel();
    while (this.xp >= need) {
      this.xp -= need;
      this.level++;
      need = this.xpForNextLevel();
    }
  }

  private applyContactDamage(dt: number): void {
    const w = this.world;
    const reach = PLAYER_RADIUS + ENEMY_RADIUS;
    let touching = false;
    this.hash.forEachNear(this.playerX, this.playerZ, (j) => {
      if (touching || w.alive[j] !== 1 || w.kind[j] !== KIND_ENEMY) return;
      const dx = w.px[j] - this.playerX;
      const dz = w.pz[j] - this.playerZ;
      if (dx * dx + dz * dz <= reach * reach) touching = true;
    });
    if (touching) this.playerHp = Math.max(0, this.playerHp - ENEMY_CONTACT_DPS * dt);
  }
}
