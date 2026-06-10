import { clamp } from "../core/math";
import { RULES } from "../data/rules";
import type { WeaponDef } from "../data/types";
import { unitType } from "../data/units";
import { rollDice } from "./dice";
import { coverAt } from "./effects";
import { heightHitBonus } from "./elevation";
import { armorArc, hexDistance, type Arc } from "./hex";
import { canFire, type GameState, type UnitInstance } from "./state";

// The one uniform combat model for EVERY unit (mech, tank, gun, infantry):
//   facing armour  →  structure  →  shared crit table  +  suppression.
// No bespoke per-unit systems. All randomness flows through rollDice (seeded +
// logged), so an attack is deterministic and auditable. Pure helpers are split
// out so the arc/penetration logic is unit-testable without the to-hit roll.

export interface AttackResult {
  fired: boolean; // false if out of ammo / cannot fire
  hit: boolean;
  arc: Arc | null;
  penetrated: boolean;
  damage: number; // structure removed
  destroyed: boolean;
  crit: string | null; // the COMPONENT knocked out this attack, if any (M2.5)
  suppression: number; // suppression added to the target
}

const NO_ATTACK: AttackResult = {
  fired: false,
  hit: false,
  arc: null,
  penetrated: false,
  damage: 0,
  destroyed: false,
  crit: null,
  suppression: 0,
};

/** Which armour facing a shot from `attacker` strikes on `target`. */
export function attackArc(attacker: UnitInstance, target: UnitInstance): Arc {
  return armorArc(target.hex, target.facing, attacker.hex);
}

/** A hit penetrates when the weapon's penetration meets or beats the armour. */
export function penetrates(penetration: number, armorValue: number): boolean {
  return penetration >= armorValue;
}

/** Armour value of the arc a shot from `attacker` would strike. */
export function arcArmor(attacker: UnitInstance, target: UnitInstance): number {
  return unitType(target.typeId).armor[attackArc(attacker, target)];
}

/** To-hit chance in [minHit, maxHit] after cover, attacker-suppression and
 *  height mods. Cover counts terrain AND battlefield effects (a fortified target
 *  is harder); direct fire gains a bonus shooting DOWN at a lower target
 *  (indirect fire arcs over, so height doesn't apply to it). */
export function hitChance(state: GameState, attacker: UnitInstance, weapon: WeaponDef, target: UnitInstance): number {
  const cover = coverAt(state, target.hex);
  const height = weapon.indirect ? 0 : heightHitBonus(state, attacker.hex, target.hex);
  const raw = weapon.accuracy - cover * RULES.coverHitPenalty - attacker.suppression * RULES.suppressionHitPenalty + height;
  return clamp(raw, RULES.minHit, RULES.maxHit);
}

/** Is `target` within `weapon`'s range band from `attacker`? */
export function inRange(attacker: UnitInstance, weapon: WeaponDef, target: UnitInstance): boolean {
  const d = hexDistance(attacker.hex, target.hex);
  return d >= weapon.rangeMin && d <= weapon.rangeMax;
}

/** Resolve one attack: consume ammo, roll to-hit, apply facing-armour
 *  penetration, structure damage, a possible crit, and suppression. Mutates the
 *  target (and attacker's ammo) in place; returns a record of what happened. */
export function resolveAttack(
  state: GameState,
  attacker: UnitInstance,
  weaponIndex: number,
  target: UnitInstance,
): AttackResult {
  const weapon = unitType(attacker.typeId).weapons[weaponIndex];
  if (!weapon || !canFire(attacker) || attacker.ammo[weaponIndex] <= 0) return NO_ATTACK;
  attacker.ammo[weaponIndex] -= 1;

  const detail = `${attacker.typeId}#${attacker.id}→${target.typeId}#${target.id}`;
  const result: AttackResult = { ...NO_ATTACK, fired: true };

  if (rollDice(state, "to-hit", detail) >= hitChance(state, attacker, weapon, target)) {
    return result; // miss
  }
  result.hit = true;

  // Suppression lands on any hit, penetrating or not (incoming fire rattles).
  target.suppression += weapon.suppression;
  result.suppression = weapon.suppression;

  const arc = attackArc(attacker, target);
  result.arc = arc;
  const armor = unitType(target.typeId).armor[arc];
  if (penetrates(weapon.penetration, armor)) {
    result.penetrated = true;
    target.structure -= weapon.damage;
    result.damage = weapon.damage;

    const maxStruct = unitType(target.typeId).structure;
    let critChance = RULES.baseCritChance;
    if (target.structure < RULES.lowStructureFraction * maxStruct) critChance += RULES.lowStructureCritBonus;
    if (rollDice(state, "crit-occurs", detail) < critChance) {
      result.crit = damageComponent(target, rollDice(state, "crit-select", detail));
    }

    if (target.structure <= 0) {
      target.structure = 0;
      result.destroyed = true;
    }
  }

  // Morale break: enough accumulated suppression shakes the crew.
  if (target.suppression >= RULES.suppressionBreak && !target.crits.includes("shaken")) {
    target.crits.push("shaken");
  }
  return result;
}

/** M2.5 — allocate a crit to one of the target's INTACT components (uniform:
 *  every unit declares its component table). The component's effect maps onto
 *  the shared states: mobility/sensors push the matching crit, a CREW hit
 *  shocks the crew (suppression spike → shaken), and a WEAPON hit disables
 *  that specific mount (the generic "weapon" crit lands only when every mount
 *  is gone). Returns the component name for the log, or null if nothing was
 *  left to break. */
export function damageComponent(target: UnitInstance, roll: number): string | null {
  const t = unitType(target.typeId);
  const intact = t.components.filter((c) => !target.componentsLost.includes(c.id));
  if (intact.length === 0) return null;
  const comp = intact[Math.min(intact.length - 1, Math.floor(roll * intact.length))];
  target.componentsLost.push(comp.id);
  if (comp.effect === "mobility" && !target.crits.includes("mobility")) target.crits.push("mobility");
  else if (comp.effect === "sensors" && !target.crits.includes("sensors")) target.crits.push("sensors");
  else if (comp.effect === "crew") {
    target.suppression += RULES.suppressionBreak; // the crew is shocked off its feet
    if (!target.crits.includes("shaken")) target.crits.push("shaken");
  } else if (comp.effect === "weapon") {
    const allOut = t.weapons.every((_, wi) =>
      t.components.some((c) => c.effect === "weapon" && c.weaponIndex === wi && target.componentsLost.includes(c.id)),
    );
    if (allOut && !target.crits.includes("weapon")) target.crits.push("weapon");
  }
  return comp.name;
}

/** Is this specific weapon mount knocked out (component damage, M2.5)? */
export function weaponDisabled(target: UnitInstance, weaponIndex: number): boolean {
  return unitType(target.typeId).components.some(
    (c) => c.effect === "weapon" && c.weaponIndex === weaponIndex && target.componentsLost.includes(c.id),
  );
}
