import {
  ARENA_RADIUS,
  ENEMY_CONTACT_DPS,
  ENEMY_HP,
  ENEMY_PIT_AVOID,
  ENEMY_PIT_LOOKAHEAD,
  ENEMY_RADIUS,
  ENEMY_SEPARATION,
  ENEMY_SPEED,
  GEM_MAGNET_RADIUS,
  GEM_MAGNET_SPEED,
  GEM_ROLL_FRICTION,
  GEM_ROLL_GRAVITY,
  GEM_ROLL_MAX_SPEED,
  GEM_VALUE,
  KNOCKBACK_DECAY,
  KNOCKBACK_IMPULSE,
  PLAYER_PICKUP_RADIUS,
  PROJECTILE_DAMAGE,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_TTL,
  SLOPE_SPEED_FACTOR,
  SLOPE_SPEED_MAX,
  SLOPE_SPEED_MIN,
  SPAWN_BATCH,
  SPAWN_INTERVAL_MIN,
  SPAWN_INTERVAL_START,
  SPAWN_RAMP_SEC,
  SPAWN_RING_RADIUS,
  WEAPON_COOLDOWN,
  WEAPON_RANGE,
  XP_BASE_PER_LEVEL,
} from "../config/balance";
import type { RunConfig } from "../config/runConfig";
import { clamp, normalize2 } from "../core/math";
import { mulberry32, type Rng } from "../core/rng";
import { highGroundMultiplier } from "./combat";
import { SpatialHash } from "./spatialHash";
import { Terrain } from "./terrain";
import { KIND_ENEMY, KIND_GEM, KIND_PROJECTILE, World } from "./world";

export interface InputState {
  x: number;
  z: number;
}

const PLAYER_RADIUS = 0.5;
const HASH_CELL = 2;

// The whole game simulation: pure typed-array state advanced by a fixed step.
// Deterministic given a RunConfig (seed + theme + character). M2 makes terrain a
// first-class input: movement, combat, gems and deaths all read the heightmap.
export class Sim {
  readonly world = new World();
  readonly terrain: Terrain;
  private readonly hash = new SpatialHash(HASH_CELL);
  private readonly rng: Rng;
  private readonly moveSpeed: number;
  private readonly maxHp: number;

  time = 0;

  // Player sim state (prev kept for render interpolation).
  playerX = 0;
  playerZ = 0;
  playerPrevX = 0;
  playerPrevZ = 0;
  playerHp: number;

  // Run stats.
  xp = 0;
  level = 1;
  kills = 0;

  private spawnTimer = 0;
  private fireTimer = 0;

  constructor(config: RunConfig) {
    this.rng = mulberry32(config.seed);
    this.terrain = new Terrain(config.seed, config.theme.terrain, ARENA_RADIUS);
    this.moveSpeed = config.character.moveSpeed;
    this.maxHp = config.character.maxHp;
    this.playerHp = this.maxHp;
    // The player starts on the central plateau — a handcrafted safe high-ground spawn.
  }

  /** XP needed to reach the next level. */
  xpForNextLevel(): number {
    return this.level * XP_BASE_PER_LEVEL;
  }

  /** Ground height under the player (for camera + render). */
  playerGroundY(): number {
    return this.terrain.heightAt(this.playerX, this.playerZ);
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

  /** Speed multiplier for heading (dirX,dirZ) at (x,z): downhill faster, uphill slower. */
  private slopeScale(x: number, z: number, dirX: number, dirZ: number): number {
    const { gx, gz } = this.terrain.gradient(x, z);
    const downhill = -(dirX * gx + dirZ * gz); // moving against the uphill gradient
    return clamp(1 + SLOPE_SPEED_FACTOR * downhill, SLOPE_SPEED_MIN, SLOPE_SPEED_MAX);
  }

  private movePlayer(dt: number, input: InputState): void {
    this.playerPrevX = this.playerX;
    this.playerPrevZ = this.playerZ;
    const len = Math.hypot(input.x, input.z);
    if (len > 0) {
      const dx = input.x / len;
      const dz = input.z / len;
      const scale = this.slopeScale(this.playerX, this.playerZ, dx, dz);
      this.playerX += input.x * this.moveSpeed * scale * dt;
      this.playerZ += input.z * this.moveSpeed * scale * dt;
      const r = Math.hypot(this.playerX, this.playerZ);
      if (r > ARENA_RADIUS) {
        this.playerX *= ARENA_RADIUS / r;
        this.playerZ *= ARENA_RADIUS / r;
      }
    }
    if (this.terrain.isPit(this.playerX, this.playerZ)) this.playerHp = 0; // fell into a pit
  }

  private spawnEnemies(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const t = clamp(this.time / SPAWN_RAMP_SEC, 0, 1);
    this.spawnTimer += SPAWN_INTERVAL_START + (SPAWN_INTERVAL_MIN - SPAWN_INTERVAL_START) * t;
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
      w.kx[id] = 0;
      w.kz[id] = 0;
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
    const kbDecay = Math.max(0, 1 - KNOCKBACK_DECAY * dt);
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_ENEMY) continue;
      const xi = w.px[i];
      const zi = w.pz[i];
      // Steer toward the player.
      let [dirX, dirZ] = normalize2(this.playerX - xi, this.playerZ - zi);
      // Soft separation from nearby enemies so the swarm spreads out.
      let sepX = 0;
      let sepZ = 0;
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
      // Pit avoidance: if there's a pit just ahead, steer toward higher ground.
      const aheadX = xi + dirX * ENEMY_PIT_LOOKAHEAD;
      const aheadZ = zi + dirZ * ENEMY_PIT_LOOKAHEAD;
      if (this.terrain.isPit(aheadX, aheadZ)) {
        const { gx, gz } = this.terrain.gradient(aheadX, aheadZ); // uphill = away from pit floor
        const [ax, az] = normalize2(gx, gz);
        dirX += ax * ENEMY_PIT_AVOID;
        dirZ += az * ENEMY_PIT_AVOID;
      }
      [dirX, dirZ] = normalize2(dirX, dirZ);
      const scale = this.slopeScale(xi, zi, dirX, dirZ);
      w.vx[i] = dirX * ENEMY_SPEED * scale;
      w.vz[i] = dirZ * ENEMY_SPEED * scale;
      // Integrate steering + decaying knockback.
      w.px[i] += (w.vx[i] + w.kx[i]) * dt;
      w.pz[i] += (w.vz[i] + w.kz[i]) * dt;
      w.kx[i] *= kbDecay;
      w.kz[i] *= kbDecay;
      // Shoved or wandered into a pit → killed (a terrain kill still drops a gem).
      if (this.terrain.isPit(w.px[i], w.pz[i])) this.killEnemy(i);
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
    w.aux[id] = this.playerGroundY(); // shooter height, for the high-ground bonus
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
        const targetY = this.terrain.heightAt(w.px[hit], w.pz[hit]);
        const mult = highGroundMultiplier(w.aux[i], targetY);
        w.hp[hit] -= w.amount[i] * mult;
        // Knockback away from the player — ideally off a ledge into a pit.
        const [kdx, kdz] = normalize2(w.px[hit] - this.playerX, w.pz[hit] - this.playerZ);
        w.kx[hit] += kdx * KNOCKBACK_IMPULSE;
        w.kz[hit] += kdz * KNOCKBACK_IMPULSE;
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
    const friction = Math.max(0, 1 - GEM_ROLL_FRICTION * dt);
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
        // Magnet overrides rolling once the player is close.
        w.px[i] += (dx / d) * GEM_MAGNET_SPEED * dt;
        w.pz[i] += (dz / d) * GEM_MAGNET_SPEED * dt;
        continue;
      }
      // Otherwise gems roll downhill (along the negative gradient).
      const { gx, gz } = this.terrain.gradient(w.px[i], w.pz[i]);
      w.vx[i] = (w.vx[i] - gx * GEM_ROLL_GRAVITY * dt) * friction;
      w.vz[i] = (w.vz[i] - gz * GEM_ROLL_GRAVITY * dt) * friction;
      const speed = Math.hypot(w.vx[i], w.vz[i]);
      if (speed > GEM_ROLL_MAX_SPEED) {
        w.vx[i] *= GEM_ROLL_MAX_SPEED / speed;
        w.vz[i] *= GEM_ROLL_MAX_SPEED / speed;
      }
      w.px[i] += w.vx[i] * dt;
      w.pz[i] += w.vz[i] * dt;
      if (this.terrain.isPit(w.px[i], w.pz[i])) w.free(i); // rolled into a pit — lost
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
