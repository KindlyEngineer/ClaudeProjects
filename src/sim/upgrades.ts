import { MAX_WEAPON_LEVEL, PASSIVE_MAX_LEVEL } from "../config/balance";
import type { Rng } from "../core/rng";
import { WEAPON_IDS, WEAPONS, type WeaponId } from "./weapons";

// The level-up draft. On level-up the player picks one of DRAFT_OPTIONS cards:
// a new weapon, a level-up for an owned weapon, or a passive stat boost. This
// module is the pure option layer — it reads the current loadout/passives and
// rolls a deterministic set of choices from the run RNG. The Sim applies the
// chosen upgrade (mutating its own state); keeping generation pure makes the
// draft unit-testable and reproducible per seed.

export type PassiveId = "damage" | "firerate" | "speed" | "maxhp" | "magnet";

export interface PassiveMeta {
  readonly id: PassiveId;
  readonly name: string;
  readonly abbr: string;
  readonly blurb: string;
}

export const PASSIVES: Record<PassiveId, PassiveMeta> = {
  damage: { id: "damage", name: "Overcharge", abbr: "DMG", blurb: "+15% damage to all weapons." },
  firerate: { id: "firerate", name: "Hair Trigger", abbr: "RoF", blurb: "+12% fire rate." },
  speed: { id: "speed", name: "Light Step", abbr: "SPD", blurb: "+8% move speed." },
  maxhp: { id: "maxhp", name: "Plating", abbr: "HP", blurb: "+20 max HP (and heal)." },
  magnet: { id: "magnet", name: "Lodestone", abbr: "MAG", blurb: "+45% gem pickup range." },
};

export const PASSIVE_IDS: PassiveId[] = ["damage", "firerate", "speed", "maxhp", "magnet"];

export type Upgrade =
  | { type: "new-weapon"; weapon: WeaponId; name: string; blurb: string }
  | { type: "level-weapon"; weapon: WeaponId; level: number; name: string; blurb: string }
  | { type: "passive"; passive: PassiveId; level: number; name: string; blurb: string };

/** A read-only view of what the player currently owns, for rolling options. */
export interface DraftState {
  /** weaponId → current level (absent = not owned). */
  readonly weapons: ReadonlyMap<WeaponId, number>;
  /** passiveId → times taken. */
  readonly passives: ReadonlyMap<PassiveId, number>;
}

/** Build the full pool of currently-valid upgrades (before random selection). */
function candidatePool(state: DraftState): Upgrade[] {
  const pool: Upgrade[] = [];
  for (const id of WEAPON_IDS) {
    const lvl = state.weapons.get(id);
    if (lvl === undefined) {
      pool.push({ type: "new-weapon", weapon: id, name: WEAPONS[id].name, blurb: WEAPONS[id].blurb });
    } else if (lvl < MAX_WEAPON_LEVEL) {
      pool.push({
        type: "level-weapon",
        weapon: id,
        level: lvl + 1,
        name: `${WEAPONS[id].name} Lv${lvl + 1}`,
        blurb: WEAPONS[id].blurb,
      });
    }
  }
  for (const id of PASSIVE_IDS) {
    const taken = state.passives.get(id) ?? 0;
    if (taken < PASSIVE_MAX_LEVEL) {
      pool.push({
        type: "passive",
        passive: id,
        level: taken + 1,
        name: `${PASSIVES[id].name} Lv${taken + 1}`,
        blurb: PASSIVES[id].blurb,
      });
    }
  }
  return pool;
}

/** Roll `count` distinct upgrade options deterministically from the run RNG.
 *  Returns fewer than `count` only if the pool is smaller (everything maxed). */
export function rollUpgrades(state: DraftState, rng: Rng, count: number): Upgrade[] {
  const pool = candidatePool(state);
  // Fisher–Yates partial shuffle using the seeded RNG, then take the first N.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.min(count, pool.length));
}
