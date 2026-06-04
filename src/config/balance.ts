// All tunable numbers live here so balance is one file, not scattered constants.

/** Simulation runs at a fixed timestep; render interpolates between sim states. */
export const SIM_HZ = 60;
export const FIXED_DT = 1 / SIM_HZ;

/** A run lasts at most 30 minutes (design decision). */
export const RUN_LENGTH_SEC = 30 * 60;

// ─── Player ────────────────────────────────────────────────────────────────
export const PLAYER_SPEED = 9; // world units / second (XZ plane)
export const PLAYER_MAX_HP = 100;
export const PLAYER_PICKUP_RADIUS = 1.4; // gem collection contact radius

// ─── Camera (tilted follow cam — the "Megabonk angle") ──────────────────────
export const CAMERA_HEIGHT = 18; // units above the focus point
export const CAMERA_DISTANCE = 20; // units behind the focus point (+Z)
// → tilt ≈ atan(18/20) ≈ 42° from horizontal.

// ─── World / ECS ─────────────────────────────────────────────────────────────
export const MAX_ENTITIES = 4096;

// ─── Enemies ─────────────────────────────────────────────────────────────────
export const ENEMY_SPEED = 3.2;
export const ENEMY_HP = 12;
export const ENEMY_RADIUS = 0.6;
export const ENEMY_CONTACT_DPS = 14; // damage/sec while overlapping the player
export const ENEMY_SEPARATION = 0.9; // soft push so the swarm spreads, not stacks

// ─── Spawn director ───────────────────────────────────────────────────────────
export const SPAWN_RING_RADIUS = 26; // enemies appear this far from the player
export const SPAWN_INTERVAL_START = 0.55; // seconds between spawns at t=0
export const SPAWN_INTERVAL_MIN = 0.07; // floor as difficulty ramps
export const SPAWN_RAMP_SEC = 240; // time to ramp from start → min interval
export const SPAWN_BATCH = 2; // enemies per spawn tick

// ─── Auto-weapon (fires at the nearest enemy on a cadence) ──────────────────
export const WEAPON_COOLDOWN = 0.32; // seconds between shots
export const WEAPON_RANGE = 22; // won't fire if nearest enemy is farther
export const PROJECTILE_SPEED = 26;
export const PROJECTILE_TTL = 1.1; // seconds before it expires
export const PROJECTILE_DAMAGE = 7; // ENEMY_HP=12 → 2 hits to kill
export const PROJECTILE_RADIUS = 0.4;

// ─── XP gems / leveling ─────────────────────────────────────────────────────
export const GEM_VALUE = 1;
export const GEM_MAGNET_RADIUS = 5; // gems home in once the player is this close
export const GEM_MAGNET_SPEED = 14;
export const XP_BASE_PER_LEVEL = 6; // xp for level 2; grows linearly per level

// ─── Tile-based levels (the cover/geometry differentiator) ──────────────────
// Levels are a grid of tiles assembled from pre-made chunks: a flat walkable
// floor studded with blocking geometry (walls/cover) and lethal hazard tiles.
export const CELL = 2; // world units per tile
export const CHUNK_SIZE = 8; // tiles per chunk edge
export const CHUNK_GRID = 6; // chunks per arena edge → 48×48 tiles, 96×96 world

export const WALL_HEIGHT = 3.4; // full walls: block movement, projectiles, sight
export const COVER_HEIGHT = 1.3; // low cover (crates): same blocking, shorter look

// Knockback — shove enemies into hazards / against walls.
export const KNOCKBACK_IMPULSE = 7.5;
export const KNOCKBACK_DECAY = 6; // per-second decay

// Enemy pathing: the flow field is rebuilt from the player every N sim ticks.
export const FLOW_REBUILD_TICKS = 4;

// ─── Weapons (M3 build loop) ─────────────────────────────────────────────────
// One auto-weapon per archetype; each levels via the draft. Stats below are the
// L1 baseline — weapons.ts scales them per level and applies passive multipliers.
export const MAX_WEAPON_LEVEL = 6;
export const DRAFT_OPTIONS = 3; // cards offered on each level-up

// Gun — the starting weapon: single shot at the nearest visible enemy.
export const GUN_COOLDOWN = 0.32;
export const GUN_DAMAGE = 7;
export const GUN_KNOCKBACK = 7.5;

// Lance — piercing/lane: a fast bolt that punches through a chokepoint of enemies.
export const LANCE_COOLDOWN = 0.7;
export const LANCE_DAMAGE = 6;
export const LANCE_SPEED = 34;
export const LANCE_RANGE = 26;
export const LANCE_PIERCE = 2; // enemies pierced at L1 (+1 / level)
export const LANCE_TTL = 1.0;

// Lobber — arcs OVER walls (ignores LOS); area damage where it lands. Counters cover.
export const LOB_COOLDOWN = 1.15;
export const LOB_DAMAGE = 9;
export const LOB_SPEED = 17;
export const LOB_RANGE = 22;
export const LOB_AREA = 2.6; // explosion radius at L1
export const LOB_TTL = 2.2;

// Orbit — aura blades circling the player; cover-agnostic, the always-safe pick.
export const ORBIT_COUNT = 2; // blades at L1 (+1 every other level)
export const ORBIT_RADIUS = 3.3;
export const ORBIT_ANGULAR_SPEED = 2.6; // radians / second
export const ORBIT_DPS = 24; // damage / second to overlapped enemies
export const ORBIT_HIT_RADIUS = 0.95;

// Knocker — heavy knockback, low damage: the "shove them into the hazard" weapon.
export const KNOCKER_COOLDOWN = 0.95;
export const KNOCKER_DAMAGE = 3;
export const KNOCKER_SPEED = 21;
export const KNOCKER_RANGE = 17;
export const KNOCKER_KNOCKBACK = 22; // big impulse vs the gun's 7.5
export const KNOCKER_TTL = 0.85;

// Passive stat cards (each can be drafted up to PASSIVE_MAX_LEVEL times).
export const PASSIVE_MAX_LEVEL = 5;
export const PASSIVE_DMG_STEP = 0.15; // +15% global damage / level
export const PASSIVE_FIRERATE_STEP = 0.12; // +12% fire rate (shorter cooldown) / level
export const PASSIVE_SPEED_STEP = 0.08; // +8% move speed / level
export const PASSIVE_MAXHP_STEP = 20; // +20 max HP / level (also heals)
export const PASSIVE_MAGNET_STEP = 0.45; // +45% gem magnet radius / level

// ─── Difficulty curve + boss ─────────────────────────────────────────────────
export const ENEMY_HP_RAMP_SEC = 100; // enemy HP doubles every this many seconds
export const ENEMY_SPEED_RAMP = 0.4; // up to +40% enemy speed by full spawn ramp
export const BOSS_INTERVAL_SEC = 150; // a boss arrives every 2.5 minutes
export const BOSS_HP = 600; // first boss HP (grows each time)
export const BOSS_HP_GROWTH = 1.6; // × per subsequent boss
export const BOSS_RADIUS = 2.0;
export const BOSS_SPEED = 2.4;
export const BOSS_CONTACT_DPS = 30;
export const BOSS_GEM_DROP = 18; // XP gems scattered on death
