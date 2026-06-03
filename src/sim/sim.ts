import {
  ENEMY_CONTACT_DPS,
  ENEMY_HP,
  ENEMY_RADIUS,
  ENEMY_SEPARATION,
  ENEMY_SPEED,
  FLOW_REBUILD_TICKS,
  GEM_MAGNET_RADIUS,
  GEM_MAGNET_SPEED,
  GEM_VALUE,
  KNOCKBACK_DECAY,
  KNOCKBACK_IMPULSE,
  PLAYER_PICKUP_RADIUS,
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
import type { RunConfig } from "../config/runConfig";
import { clamp, normalize2 } from "../core/math";
import { mulberry32, type Rng } from "../core/rng";
import { FlowField } from "./flowField";
import { generateLevel, snapToFloor } from "./levelGen";
import { Level } from "./level";
import { SpatialHash } from "./spatialHash";
import { KIND_ENEMY, KIND_GEM, KIND_PROJECTILE, World } from "./world";

export interface InputState {
  x: number;
  z: number;
}

const PLAYER_RADIUS = 0.5;
const HASH_CELL = 2;

// The whole game simulation: pure typed-array state advanced by a fixed step.
// Deterministic given a RunConfig. The arena is a tile grid (sim/level): a flat
// walkable floor with blocking walls/cover and lethal hazard tiles. Geometry —
// not height — is the differentiator: it stops movement, blocks line of fire,
// funnels the flow-field horde, and (via knockback) becomes a kill-zone.
export class Sim {
  readonly world = new World();
  readonly level: Level;
  private readonly flow: FlowField;
  private readonly hash = new SpatialHash(HASH_CELL);
  private readonly rng: Rng;
  private readonly moveSpeed: number;
  private readonly maxHp: number;

  time = 0;
  private tick = 0;

  playerX = 0;
  playerZ = 0;
  playerPrevX = 0;
  playerPrevZ = 0;
  playerHp: number;

  xp = 0;
  playerLevel = 1;
  kills = 0;

  private spawnTimer = 0;
  private fireTimer = 0;

  constructor(config: RunConfig) {
    this.rng = mulberry32(config.seed);
    this.level = generateLevel(config.seed, config.theme);
    this.flow = new FlowField(this.level.cols, this.level.rows);
    this.moveSpeed = config.character.moveSpeed;
    this.maxHp = config.character.maxHp;
    this.playerHp = this.maxHp;
    const start = snapToFloor(this.level, 0, 0); // central plaza is open
    this.playerX = start.x;
    this.playerZ = start.z;
  }

  xpForNextLevel(): number {
    return this.playerLevel * XP_BASE_PER_LEVEL;
  }

  update(dt: number, input: InputState): void {
    this.time += dt;
    this.tick++;
    this.movePlayer(dt, input);
    this.spawnEnemies(dt);
    if (this.tick % FLOW_REBUILD_TICKS === 1) {
      this.flow.rebuild(this.level, this.level.cellX(this.playerX), this.level.cellZ(this.playerZ));
    }
    this.rebuildEnemyHash();
    this.updateEnemies(dt);
    this.fireWeapon(dt);
    this.updateProjectiles(dt);
    this.updateGems(dt);
    this.applyLeveling();
    this.applyContactDamage(dt);
  }

  /** Move from (x,z) by (dx,dz), sliding along solid tiles. */
  private resolveMove(x: number, z: number, dx: number, dz: number): [number, number] {
    let nx = x + dx;
    if (this.level.blocksMovement(nx, z)) nx = x;
    let nz = z + dz;
    if (this.level.blocksMovement(nx, nz)) nz = z;
    return [nx, nz];
  }

  private movePlayer(dt: number, input: InputState): void {
    this.playerPrevX = this.playerX;
    this.playerPrevZ = this.playerZ;
    const len = Math.hypot(input.x, input.z);
    if (len > 0) {
      const dx = (input.x / len) * this.moveSpeed * dt;
      const dz = (input.z / len) * this.moveSpeed * dt;
      [this.playerX, this.playerZ] = this.resolveMove(this.playerX, this.playerZ, dx, dz);
    }
    if (this.level.isHazard(this.playerX, this.playerZ)) this.playerHp = 0;
  }

  private spawnEnemies(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const t = clamp(this.time / SPAWN_RAMP_SEC, 0, 1);
    this.spawnTimer += SPAWN_INTERVAL_START + (SPAWN_INTERVAL_MIN - SPAWN_INTERVAL_START) * t;
    for (let n = 0; n < SPAWN_BATCH; n++) {
      const a = this.rng() * Math.PI * 2;
      const sx = this.playerX + Math.cos(a) * SPAWN_RING_RADIUS;
      const sz = this.playerZ + Math.sin(a) * SPAWN_RING_RADIUS;
      const spot = snapToFloor(this.level, sx, sz); // never spawn inside geometry
      const id = this.world.spawn();
      if (id < 0) return;
      const w = this.world;
      w.kind[id] = KIND_ENEMY;
      w.px[id] = spot.x;
      w.pz[id] = spot.z;
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
      // Flow-field direction toward the player (routes around walls); fall back
      // to a straight beeline if this cell wasn't reached by the BFS.
      const { fx, fz } = this.flow.sampleCell(this.level.cellX(xi), this.level.cellZ(zi));
      let dirX = fx;
      let dirZ = fz;
      if (fx === 0 && fz === 0) [dirX, dirZ] = normalize2(this.playerX - xi, this.playerZ - zi);
      // Soft separation so the swarm spreads instead of stacking.
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
      [dirX, dirZ] = normalize2(dirX + sepX * ENEMY_SEPARATION, dirZ + sepZ * ENEMY_SEPARATION);
      w.vx[i] = dirX * ENEMY_SPEED;
      w.vz[i] = dirZ * ENEMY_SPEED;
      const dx = (w.vx[i] + w.kx[i]) * dt;
      const dz = (w.vz[i] + w.kz[i]) * dt;
      [w.px[i], w.pz[i]] = this.resolveMove(xi, zi, dx, dz);
      w.kx[i] *= kbDecay;
      w.kz[i] *= kbDecay;
      if (this.level.isHazard(w.px[i], w.pz[i])) this.killEnemy(i); // shoved into a hazard
    }
  }

  /** Nearest enemy with clear line of fire, within range, or -1. */
  private nearestVisibleEnemy(): number {
    const w = this.world;
    let best = -1;
    let bestD2 = WEAPON_RANGE * WEAPON_RANGE;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_ENEMY) continue;
      const dx = w.px[i] - this.playerX;
      const dz = w.pz[i] - this.playerZ;
      const d2 = dx * dx + dz * dz;
      if (d2 >= bestD2) continue;
      if (!this.level.hasLineOfSight(this.playerX, this.playerZ, w.px[i], w.pz[i])) continue;
      bestD2 = d2;
      best = i;
    }
    return best;
  }

  private fireWeapon(dt: number): void {
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    const target = this.nearestVisibleEnemy();
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
      if (this.level.blocksProjectile(w.px[i], w.pz[i])) {
        w.free(i); // absorbed by wall/cover
        continue;
      }
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
      this.playerLevel++;
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
