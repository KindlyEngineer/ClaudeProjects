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
