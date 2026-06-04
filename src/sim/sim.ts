import {
  BOSS_CONTACT_DPS,
  BOSS_GEM_DROP,
  BOSS_HP,
  BOSS_HP_GROWTH,
  BOSS_INTERVAL_SEC,
  BOSS_RADIUS,
  BOSS_SPEED,
  DRAFT_OPTIONS,
  ENEMY_CONTACT_DPS,
  ENEMY_HP,
  ENEMY_HP_RAMP_SEC,
  ENEMY_RADIUS,
  ENEMY_SEPARATION,
  ENEMY_SPEED,
  ENEMY_SPEED_RAMP,
  FLOW_REBUILD_TICKS,
  GEM_MAGNET_RADIUS,
  GEM_MAGNET_SPEED,
  GEM_VALUE,
  KNOCKBACK_DECAY,
  PASSIVE_DMG_STEP,
  PASSIVE_FIRERATE_STEP,
  PASSIVE_MAGNET_STEP,
  PASSIVE_MAXHP_STEP,
  PASSIVE_SPEED_STEP,
  PLAYER_PICKUP_RADIUS,
  PROJECTILE_RADIUS,
  SPAWN_BATCH,
  SPAWN_INTERVAL_MIN,
  SPAWN_INTERVAL_START,
  SPAWN_RAMP_SEC,
  SPAWN_RING_RADIUS,
  XP_BASE_PER_LEVEL,
} from "../config/balance";
import type { RunConfig } from "../config/runConfig";
import { clamp, normalize2 } from "../core/math";
import { mulberry32, type Rng } from "../core/rng";
import { FlowField } from "./flowField";
import { generateLevel, snapToFloor } from "./levelGen";
import { Level } from "./level";
import { SpatialHash } from "./spatialHash";
import {
  KIND_ENEMY,
  KIND_GEM,
  KIND_ORBITER,
  KIND_PROJECTILE,
  VARIANT_BOSS,
  VARIANT_GRUNT,
  World,
} from "./world";
import {
  orbitStats,
  projectileStats,
  W_GUN,
  W_LOB,
  W_ORBIT,
  WEAPONS,
  type Mods,
  type WeaponId,
} from "./weapons";
import { PASSIVES, rollUpgrades, type DraftState, type PassiveId, type Upgrade } from "./upgrades";

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
//
// M3 adds the build loop: a per-archetype weapon set (sim/weapons), per-weapon
// leveling, a level-up upgrade draft (sim/upgrades), a difficulty ramp and a
// timed boss. The draft auto-resolves when `autoDraft` is set (tests, warp,
// pilots); the live game flips it off so the UI presents the cards.
export class Sim {
  readonly world = new World();
  readonly level: Level;
  private readonly flow: FlowField;
  private readonly hash = new SpatialHash(HASH_CELL);
  private readonly rng: Rng;

  private readonly baseMoveSpeed: number;
  private readonly baseMaxHp: number;

  time = 0;
  private tick = 0;

  playerX = 0;
  playerZ = 0;
  playerPrevX = 0;
  playerPrevZ = 0;
  playerHp: number;
  maxHp: number;

  xp = 0;
  playerLevel = 1;
  kills = 0;

  // ── Build state ──
  /** Owned weapons → level (insertion order is the deterministic fire order). */
  readonly loadout = new Map<WeaponId, number>([[W_GUN, 1]]);
  /** Passive stat cards → times taken. */
  readonly passives = new Map<PassiveId, number>();
  private mods: Mods = { dmgMul: 1, fireRateMul: 1 };
  private moveSpeedMul = 1;
  private magnetMul = 1;
  private readonly fireTimers = new Float64Array(8); // per weapon-id cooldown

  /** Queue of pending level-up draft option-sets (front is current). */
  readonly pendingDrafts: Upgrade[][] = [];
  /** When true, drafts resolve immediately via RNG (headless/warp/pilot runs). */
  autoDraft = true;

  private orbitPhase = 0;
  private spawnTimer = 0;
  private bossesSpawned = 0;
  private nextBossTime = BOSS_INTERVAL_SEC;

  constructor(config: RunConfig) {
    this.rng = mulberry32(config.seed);
    this.level = generateLevel(config.seed, config.theme);
    this.flow = new FlowField(this.level.cols, this.level.rows);
    this.baseMoveSpeed = config.character.moveSpeed;
    this.baseMaxHp = config.character.maxHp;
    this.maxHp = this.baseMaxHp;
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
    this.maybeSpawnBoss();
    if (this.tick % FLOW_REBUILD_TICKS === 1) {
      this.flow.rebuild(this.level, this.level.cellX(this.playerX), this.level.cellZ(this.playerZ));
    }
    this.rebuildEnemyHash();
    this.updateEnemies(dt);
    this.updateWeapons(dt);
    this.updateOrbiters(dt);
    this.updateProjectiles(dt);
    this.updateGems(dt);
    this.applyLeveling();
    this.applyContactDamage(dt);
  }

  // ── Movement ──
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
      const speed = this.baseMoveSpeed * this.moveSpeedMul;
      const dx = (input.x / len) * speed * dt;
      const dz = (input.z / len) * speed * dt;
      [this.playerX, this.playerZ] = this.resolveMove(this.playerX, this.playerZ, dx, dz);
    }
    if (this.level.isHazard(this.playerX, this.playerZ)) this.playerHp = 0;
  }

  // ── Spawning + difficulty curve ──
  private gruntHp(): number {
    return ENEMY_HP * (1 + this.time / ENEMY_HP_RAMP_SEC);
  }
  private gruntSpeed(): number {
    return ENEMY_SPEED * (1 + ENEMY_SPEED_RAMP * clamp(this.time / SPAWN_RAMP_SEC, 0, 1));
  }

  private spawnEnemies(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const t = clamp(this.time / SPAWN_RAMP_SEC, 0, 1);
    this.spawnTimer += SPAWN_INTERVAL_START + (SPAWN_INTERVAL_MIN - SPAWN_INTERVAL_START) * t;
    const hp = this.gruntHp();
    for (let n = 0; n < SPAWN_BATCH; n++) {
      const a = this.rng() * Math.PI * 2;
      const sx = this.playerX + Math.cos(a) * SPAWN_RING_RADIUS;
      const sz = this.playerZ + Math.sin(a) * SPAWN_RING_RADIUS;
      const spot = snapToFloor(this.level, sx, sz); // never spawn inside geometry
      this.spawnEnemy(spot.x, spot.z, VARIANT_GRUNT, hp, ENEMY_RADIUS);
    }
  }

  private maybeSpawnBoss(): void {
    if (this.time < this.nextBossTime) return;
    this.nextBossTime += BOSS_INTERVAL_SEC;
    const hp = BOSS_HP * Math.pow(BOSS_HP_GROWTH, this.bossesSpawned);
    this.bossesSpawned++;
    const a = this.rng() * Math.PI * 2;
    const sx = this.playerX + Math.cos(a) * (SPAWN_RING_RADIUS + 4);
    const sz = this.playerZ + Math.sin(a) * (SPAWN_RING_RADIUS + 4);
    const spot = snapToFloor(this.level, sx, sz);
    this.spawnEnemy(spot.x, spot.z, VARIANT_BOSS, hp, BOSS_RADIUS);
  }

  private spawnEnemy(x: number, z: number, variant: number, hp: number, radius: number): void {
    const id = this.world.spawn();
    if (id < 0) return;
    const w = this.world;
    w.kind[id] = KIND_ENEMY;
    w.variant[id] = variant;
    w.px[id] = x;
    w.pz[id] = z;
    w.vx[id] = 0;
    w.vz[id] = 0;
    w.kx[id] = 0;
    w.kz[id] = 0;
    w.hp[id] = hp;
    w.maxhp[id] = hp;
    w.radius[id] = radius;
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
    const gruntSpeed = this.gruntSpeed();
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_ENEMY) continue;
      const xi = w.px[i];
      const zi = w.pz[i];
      const speed = w.variant[i] === VARIANT_BOSS ? BOSS_SPEED : gruntSpeed;
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
      w.vx[i] = dirX * speed;
      w.vz[i] = dirZ * speed;
      const dx = (w.vx[i] + w.kx[i]) * dt;
      const dz = (w.vz[i] + w.kz[i]) * dt;
      [w.px[i], w.pz[i]] = this.resolveMove(xi, zi, dx, dz);
      w.kx[i] *= kbDecay;
      w.kz[i] *= kbDecay;
      if (this.level.isHazard(w.px[i], w.pz[i])) this.killEnemy(i); // shoved into a hazard
    }
  }

  // ── Weapons ──
  /** Nearest enemy within `range`; requires line of sight unless `ignoreLos`. */
  private acquireTarget(range: number, ignoreLos: boolean): number {
    const w = this.world;
    let best = -1;
    let bestD2 = range * range;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_ENEMY) continue;
      const dx = w.px[i] - this.playerX;
      const dz = w.pz[i] - this.playerZ;
      const d2 = dx * dx + dz * dz;
      if (d2 >= bestD2) continue;
      if (!ignoreLos && !this.level.hasLineOfSight(this.playerX, this.playerZ, w.px[i], w.pz[i]))
        continue;
      bestD2 = d2;
      best = i;
    }
    return best;
  }

  private updateWeapons(dt: number): void {
    for (const [id, level] of this.loadout) {
      if (id === W_ORBIT) continue; // aura blades are handled by updateOrbiters
      this.fireTimers[id] -= dt;
      if (this.fireTimers[id] > 0) continue;
      const stats = projectileStats(id, level, this.mods);
      const target = this.acquireTarget(stats.range, stats.ignoresLineOfSight);
      if (target < 0) continue; // no valid target yet — try again next tick
      this.fireTimers[id] = stats.cooldown;
      const w = this.world;
      const [dx, dz] = normalize2(w.px[target] - this.playerX, w.pz[target] - this.playerZ);
      const pid = w.spawn();
      if (pid < 0) continue;
      w.kind[pid] = KIND_PROJECTILE;
      w.wkind[pid] = id;
      w.px[pid] = this.playerX;
      w.pz[pid] = this.playerZ;
      w.vx[pid] = dx * stats.speed;
      w.vz[pid] = dz * stats.speed;
      w.ttl[pid] = stats.ttl;
      w.radius[pid] = PROJECTILE_RADIUS;
      w.amount[pid] = stats.damage;
      w.pierce[pid] = stats.pierce;
      w.kb[pid] = stats.knockback;
      w.area[pid] = stats.area;
      w.angle[pid] = -1; // last-hit enemy id (none yet) — prevents pierce re-hits
    }
  }

  private updateProjectiles(dt: number): void {
    const w = this.world;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_PROJECTILE) continue;
      const isLob = w.wkind[i] === W_LOB;
      w.ttl[i] -= dt;
      if (w.ttl[i] <= 0) {
        if (isLob) this.explode(w.px[i], w.pz[i], w.area[i], w.amount[i], w.kb[i]);
        w.free(i);
        continue;
      }
      w.px[i] += w.vx[i] * dt;
      w.pz[i] += w.vz[i] * dt;
      // Lobbers arc OVER walls (ignore LOS); everything else is absorbed by them.
      if (!isLob && this.level.blocksProjectile(w.px[i], w.pz[i])) {
        w.free(i);
        continue;
      }
      // Find the nearest enemy in reach that this projectile hasn't just hit.
      let hit = -1;
      let hitD2 = Infinity;
      const reach = w.radius[i] + ENEMY_RADIUS;
      const xi = w.px[i];
      const zi = w.pz[i];
      const lastHit = w.angle[i];
      this.hash.forEachNear(xi, zi, (j) => {
        if (w.alive[j] !== 1 || w.kind[j] !== KIND_ENEMY || j === lastHit) return;
        const r = reach + w.radius[j] - ENEMY_RADIUS;
        const dx = xi - w.px[j];
        const dz = zi - w.pz[j];
        const d2 = dx * dx + dz * dz;
        if (d2 <= r * r && d2 < hitD2) {
          hitD2 = d2;
          hit = j;
        }
      });
      if (hit < 0) continue;
      if (isLob) {
        this.explode(xi, zi, w.area[i], w.amount[i], w.kb[i]);
        w.free(i);
        continue;
      }
      this.damageEnemy(hit, w.amount[i], w.kb[i]);
      w.angle[i] = hit; // remember it so a piercing shot doesn't re-hit instantly
      if (w.pierce[i] > 0) w.pierce[i] -= 1;
      else w.free(i);
    }
  }

  /** Area damage centred on (x,z): hits every enemy within `area`. */
  private explode(x: number, z: number, area: number, damage: number, kb: number): void {
    if (area <= 0) {
      // Degenerate (shouldn't happen for lobs) — fall back to a point hit.
      return;
    }
    const w = this.world;
    const a2 = area * area;
    for (let j = 0; j < w.cap; j++) {
      if (w.alive[j] !== 1 || w.kind[j] !== KIND_ENEMY) continue;
      const dx = w.px[j] - x;
      const dz = w.pz[j] - z;
      if (dx * dx + dz * dz > a2) continue;
      this.damageEnemy(j, damage, kb, x, z);
    }
  }

  /** Apply damage + knockback (radial from `fromX,fromZ`, default the player). */
  private damageEnemy(id: number, damage: number, kb: number, fromX?: number, fromZ?: number): void {
    const w = this.world;
    w.hp[id] -= damage;
    if (kb > 0) {
      const ox = fromX ?? this.playerX;
      const oz = fromZ ?? this.playerZ;
      const [kdx, kdz] = normalize2(w.px[id] - ox, w.pz[id] - oz);
      w.kx[id] += kdx * kb;
      w.kz[id] += kdz * kb;
    }
    if (w.hp[id] <= 0) this.killEnemy(id);
  }

  // ── Orbit blades (cover-agnostic aura weapon) ──
  /** Match the number of live orbiter entities to the orbit weapon's level. */
  private reconcileOrbiters(): void {
    const w = this.world;
    const level = this.loadout.get(W_ORBIT);
    const desired = level ? orbitStats(level, this.mods).count : 0;
    const live: number[] = [];
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] === 1 && w.kind[i] === KIND_ORBITER) live.push(i);
    }
    for (let k = desired; k < live.length; k++) w.free(live[k]);
    for (let k = live.length; k < desired; k++) {
      const id = w.spawn();
      if (id < 0) break;
      w.kind[id] = KIND_ORBITER;
      w.wkind[id] = W_ORBIT;
      live.push(id);
    }
    // Re-space the survivors evenly around the ring.
    const final: number[] = [];
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] === 1 && w.kind[i] === KIND_ORBITER) final.push(i);
    }
    for (let k = 0; k < final.length; k++) {
      w.angle[final[k]] = final.length > 0 ? (k / final.length) * Math.PI * 2 : 0;
    }
  }

  private updateOrbiters(dt: number): void {
    const level = this.loadout.get(W_ORBIT);
    if (!level) return;
    const w = this.world;
    const s = orbitStats(level, this.mods);
    this.orbitPhase += s.angularSpeed * dt;
    const dmg = s.dps * dt;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_ORBITER) continue;
      const ang = w.angle[i] + this.orbitPhase;
      const ox = this.playerX + Math.cos(ang) * s.radius;
      const oz = this.playerZ + Math.sin(ang) * s.radius;
      w.px[i] = ox;
      w.pz[i] = oz;
      const reach = s.hitRadius + ENEMY_RADIUS;
      this.hash.forEachNear(ox, oz, (j) => {
        if (w.alive[j] !== 1 || w.kind[j] !== KIND_ENEMY) return;
        const dx = w.px[j] - ox;
        const dz = w.pz[j] - oz;
        const r = reach + w.radius[j] - ENEMY_RADIUS;
        if (dx * dx + dz * dz <= r * r) this.damageEnemy(j, dmg, 2, ox, oz);
      });
    }
  }

  private killEnemy(id: number): void {
    const w = this.world;
    const ex = w.px[id];
    const ez = w.pz[id];
    const boss = w.variant[id] === VARIANT_BOSS;
    w.free(id);
    this.kills++;
    const drops = boss ? BOSS_GEM_DROP : 1;
    for (let n = 0; n < drops; n++) {
      const gem = w.spawn();
      if (gem < 0) return;
      w.kind[gem] = KIND_GEM;
      const spread = boss ? 2.5 : 0;
      w.px[gem] = ex + (this.rng() - 0.5) * spread;
      w.pz[gem] = ez + (this.rng() - 0.5) * spread;
      w.vx[gem] = 0;
      w.vz[gem] = 0;
      w.amount[gem] = GEM_VALUE;
    }
  }

  private updateGems(dt: number): void {
    const w = this.world;
    const magnet = GEM_MAGNET_RADIUS * this.magnetMul;
    const pickup = PLAYER_PICKUP_RADIUS;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1 || w.kind[i] !== KIND_GEM) continue;
      const dx = this.playerX - w.px[i];
      const dz = this.playerZ - w.pz[i];
      const d = Math.hypot(dx, dz);
      if (d <= pickup) {
        this.xp += w.amount[i];
        w.free(i);
        continue;
      }
      if (d <= magnet && d > 0) {
        w.px[i] += (dx / d) * GEM_MAGNET_SPEED * dt;
        w.pz[i] += (dz / d) * GEM_MAGNET_SPEED * dt;
      }
    }
  }

  // ── Leveling + the upgrade draft ──
  private applyLeveling(): void {
    let need = this.xpForNextLevel();
    while (this.xp >= need) {
      this.xp -= need;
      this.playerLevel++;
      this.pendingDrafts.push(rollUpgrades(this.draftState(), this.rng, DRAFT_OPTIONS));
      need = this.xpForNextLevel();
    }
    if (this.autoDraft) {
      while (this.pendingDrafts.length > 0) {
        const opts = this.pendingDrafts[0];
        this.chooseUpgrade(opts.length > 0 ? (this.rng() * opts.length) | 0 : 0);
      }
    }
  }

  private draftState(): DraftState {
    return { weapons: this.loadout, passives: this.passives };
  }

  /** True while a level-up draft is awaiting a choice (live UI pauses on this). */
  draftPending(): boolean {
    return this.pendingDrafts.length > 0;
  }
  /** The option-set the player must currently choose from, or null. */
  currentDraft(): Upgrade[] | null {
    return this.pendingDrafts[0] ?? null;
  }

  /** Apply the chosen option from the current draft and advance the queue. */
  chooseUpgrade(index: number): void {
    const opts = this.pendingDrafts.shift();
    if (!opts || opts.length === 0) return;
    const choice = opts[clamp(index, 0, opts.length - 1) | 0];
    switch (choice.type) {
      case "new-weapon":
        this.loadout.set(choice.weapon, 1);
        break;
      case "level-weapon":
        this.loadout.set(choice.weapon, choice.level);
        break;
      case "passive":
        this.takePassive(choice.passive);
        break;
    }
    if (choice.type !== "passive" && choice.weapon === W_ORBIT) this.reconcileOrbiters();
    if (choice.type === "passive") this.recomputeMods();
  }

  private takePassive(id: PassiveId): void {
    const next = (this.passives.get(id) ?? 0) + 1;
    this.passives.set(id, next);
    if (id === "maxhp") {
      this.maxHp += PASSIVE_MAXHP_STEP;
      this.playerHp = Math.min(this.maxHp, this.playerHp + PASSIVE_MAXHP_STEP);
    }
  }

  /** Recompute cached passive multipliers and refresh orbiter count. */
  private recomputeMods(): void {
    const dmg = this.passives.get("damage") ?? 0;
    const rof = this.passives.get("firerate") ?? 0;
    const spd = this.passives.get("speed") ?? 0;
    const mag = this.passives.get("magnet") ?? 0;
    this.mods = {
      dmgMul: 1 + dmg * PASSIVE_DMG_STEP,
      fireRateMul: 1 + rof * PASSIVE_FIRERATE_STEP,
    };
    this.moveSpeedMul = 1 + spd * PASSIVE_SPEED_STEP;
    this.magnetMul = 1 + mag * PASSIVE_MAGNET_STEP;
    if (this.loadout.has(W_ORBIT)) this.reconcileOrbiters(); // dps scales but count may too
  }

  private applyContactDamage(dt: number): void {
    const w = this.world;
    let dps = 0;
    this.hash.forEachNear(this.playerX, this.playerZ, (j) => {
      if (w.alive[j] !== 1 || w.kind[j] !== KIND_ENEMY) return;
      const reach = PLAYER_RADIUS + w.radius[j];
      const dx = w.px[j] - this.playerX;
      const dz = w.pz[j] - this.playerZ;
      if (dx * dx + dz * dz <= reach * reach) {
        const edps = w.variant[j] === VARIANT_BOSS ? BOSS_CONTACT_DPS : ENEMY_CONTACT_DPS;
        if (edps > dps) dps = edps; // strongest threat in contact, not a sum
      }
    });
    if (dps > 0) this.playerHp = Math.max(0, this.playerHp - dps * dt);
  }

  // ── Read-only helpers for the HUD ──
  /** Owned weapons as `[abbr, level]`, in fire order. */
  weaponSummary(): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const [id, level] of this.loadout) out.push([WEAPONS[id].abbr, level]);
    return out;
  }
  /** Taken passives as `[abbr, level]`. */
  passiveSummary(): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const [id, n] of this.passives) out.push([PASSIVES[id].abbr, n]);
    return out;
  }
  /** Fraction of HP of the toughest live boss (for a HUD bar), or 0 if none. */
  bossHealthFraction(): number {
    const w = this.world;
    let frac = 0;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] === 1 && w.kind[i] === KIND_ENEMY && w.variant[i] === VARIANT_BOSS) {
        frac = Math.max(frac, w.maxhp[i] > 0 ? w.hp[i] / w.maxhp[i] : 0);
      }
    }
    return frac;
  }
}
