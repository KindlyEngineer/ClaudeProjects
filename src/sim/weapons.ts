import {
  GUN_COOLDOWN,
  GUN_DAMAGE,
  GUN_KNOCKBACK,
  KNOCKER_COOLDOWN,
  KNOCKER_DAMAGE,
  KNOCKER_KNOCKBACK,
  KNOCKER_RANGE,
  KNOCKER_SPEED,
  KNOCKER_TTL,
  LANCE_COOLDOWN,
  LANCE_DAMAGE,
  LANCE_PIERCE,
  LANCE_RANGE,
  LANCE_SPEED,
  LANCE_TTL,
  LOB_AREA,
  LOB_COOLDOWN,
  LOB_DAMAGE,
  LOB_RANGE,
  LOB_SPEED,
  LOB_TTL,
  ORBIT_ANGULAR_SPEED,
  ORBIT_COUNT,
  ORBIT_DPS,
  ORBIT_HIT_RADIUS,
  ORBIT_RADIUS,
  WEAPON_RANGE,
} from "../config/balance";

// Weapon archetypes — each one is designed to exploit the arena geometry in a
// different way (see design.md §5). The Sim owns the firing/spawning behaviour;
// this module is the pure data layer: metadata + per-level stat scaling +
// passive-multiplier application, so balance is unit-testable without a sim.

export const W_GUN = 0; // baseline single shot, LOS-gated
export const W_LANCE = 1; // piercing lane — shreds a chokepoint
export const W_LOB = 2; // arcs over walls, area damage — counters cover
export const W_ORBIT = 3; // aura blades — cover-agnostic, always-safe
export const W_KNOCKER = 4; // heavy knockback — shove enemies into hazards

export const WEAPON_IDS = [W_GUN, W_LANCE, W_LOB, W_ORBIT, W_KNOCKER] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export interface WeaponMeta {
  readonly id: WeaponId;
  readonly name: string;
  readonly abbr: string; // short tag for the HUD
  readonly blurb: string; // one-line draft-card description
}

export const WEAPONS: Record<WeaponId, WeaponMeta> = {
  [W_GUN]: { id: W_GUN, name: "Auto-Gun", abbr: "GUN", blurb: "Single shot at the nearest target in sight." },
  [W_LANCE]: { id: W_LANCE, name: "Lance", abbr: "LNC", blurb: "Piercing bolt — skewers a whole chokepoint." },
  [W_LOB]: { id: W_LOB, name: "Lobber", abbr: "LOB", blurb: "Arcs over walls; explodes on impact." },
  [W_ORBIT]: { id: W_ORBIT, name: "Orbit Blades", abbr: "ORB", blurb: "Blades circle you — ignores line of sight." },
  [W_KNOCKER]: { id: W_KNOCKER, name: "Knocker", abbr: "KNK", blurb: "Heavy knockback — shove the swarm into hazards." },
};

/** Passive multipliers from drafted stat cards; applied to weapon stats. */
export interface Mods {
  dmgMul: number; // global damage multiplier
  fireRateMul: number; // >1 = faster (cooldown divided by this)
}

export const NO_MODS: Mods = { dmgMul: 1, fireRateMul: 1 };

// ── Per-level stat resolvers ────────────────────────────────────────────────
// Each returns the *effective* stats for (level, mods). Cooldowns shrink with
// fire rate; damage scales with the damage mult. Level is 1-based.

export interface ProjectileWeaponStats {
  cooldown: number;
  damage: number;
  speed: number;
  range: number;
  ttl: number;
  pierce: number; // enemies punched through (0 = dies on first hit)
  area: number; // explosion radius (0 = single-target)
  knockback: number;
  ignoresLineOfSight: boolean; // lobber arcs over walls
}

export function gunStats(level: number, mods: Mods): ProjectileWeaponStats {
  return {
    cooldown: (GUN_COOLDOWN * (1 - 0.06 * (level - 1))) / mods.fireRateMul,
    damage: (GUN_DAMAGE + 2 * (level - 1)) * mods.dmgMul,
    speed: 26,
    range: WEAPON_RANGE,
    ttl: 1.1,
    pierce: 0,
    area: 0,
    knockback: GUN_KNOCKBACK,
    ignoresLineOfSight: false,
  };
}

export function lanceStats(level: number, mods: Mods): ProjectileWeaponStats {
  return {
    cooldown: (LANCE_COOLDOWN * (1 - 0.05 * (level - 1))) / mods.fireRateMul,
    damage: (LANCE_DAMAGE + 1.5 * (level - 1)) * mods.dmgMul,
    speed: LANCE_SPEED,
    range: LANCE_RANGE,
    ttl: LANCE_TTL,
    pierce: LANCE_PIERCE + (level - 1), // +1 enemy pierced per level
    area: 0,
    knockback: 4,
    ignoresLineOfSight: false,
  };
}

export function lobStats(level: number, mods: Mods): ProjectileWeaponStats {
  return {
    cooldown: (LOB_COOLDOWN * (1 - 0.05 * (level - 1))) / mods.fireRateMul,
    damage: (LOB_DAMAGE + 2.5 * (level - 1)) * mods.dmgMul,
    speed: LOB_SPEED,
    range: LOB_RANGE,
    ttl: LOB_TTL,
    pierce: 0,
    area: LOB_AREA + 0.35 * (level - 1),
    knockback: 5,
    ignoresLineOfSight: true,
  };
}

export function knockerStats(level: number, mods: Mods): ProjectileWeaponStats {
  return {
    cooldown: (KNOCKER_COOLDOWN * (1 - 0.05 * (level - 1))) / mods.fireRateMul,
    damage: (KNOCKER_DAMAGE + 1 * (level - 1)) * mods.dmgMul,
    speed: KNOCKER_SPEED,
    range: KNOCKER_RANGE,
    ttl: KNOCKER_TTL,
    pierce: Math.floor((level - 1) / 2), // a little pierce at higher levels
    area: 0,
    knockback: KNOCKER_KNOCKBACK + 3 * (level - 1),
    ignoresLineOfSight: false,
  };
}

export interface OrbitStats {
  count: number; // number of blades
  radius: number; // orbit radius
  angularSpeed: number; // radians / second
  dps: number; // damage / second to overlapped enemies
  hitRadius: number;
}

export function orbitStats(level: number, mods: Mods): OrbitStats {
  return {
    count: ORBIT_COUNT + Math.floor(level / 2), // L1:2, L2:3, L3:3, L4:4 …
    radius: ORBIT_RADIUS + 0.15 * (level - 1),
    angularSpeed: ORBIT_ANGULAR_SPEED,
    dps: (ORBIT_DPS + 6 * (level - 1)) * mods.dmgMul,
    hitRadius: ORBIT_HIT_RADIUS,
  };
}

/** Returns the projectile stats for any projectile-archetype weapon. */
export function projectileStats(id: WeaponId, level: number, mods: Mods): ProjectileWeaponStats {
  switch (id) {
    case W_LANCE:
      return lanceStats(level, mods);
    case W_LOB:
      return lobStats(level, mods);
    case W_KNOCKER:
      return knockerStats(level, mods);
    case W_GUN:
    default:
      return gunStats(level, mods);
  }
}
