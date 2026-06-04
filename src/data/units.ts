import type { UnitType } from "./types";

// Unit table. One uniform combat model across all classes (brief §2): armour by
// facing + structure + the shared crit table. Mechs are differentiated only by
// capability and sustainment cost, NOT by bespoke internal systems. Everything
// here is data — add a row to add a unit.

export const UNITS: Record<string, UnitType> = {
  // ── Main effort (commander-controlled) ──
  mech_assault: {
    id: "mech_assault",
    name: "Assault Mech",
    cls: "mech",
    armor: { front: 9, side: 6, rear: 4 },
    structure: 30,
    move: 4,
    fuelMax: 24,
    vision: 6,
    light: false,
    weapons: [
      { name: "Autocannon", damage: 8, rangeMin: 0, rangeMax: 11, accuracy: 0.7, suppression: 2, ammoMax: 10, indirect: false, penetration: 8 },
      { name: "SRM Pack", damage: 5, rangeMin: 0, rangeMax: 5, accuracy: 0.75, suppression: 3, ammoMax: 8, indirect: false, penetration: 6 },
    ],
  },

  // ── Player support / logistics effort ──
  recon: {
    id: "recon",
    name: "Recon Scout",
    cls: "recon",
    armor: { front: 2, side: 1, rear: 1 },
    structure: 6,
    move: 8,
    fuelMax: 48,
    vision: 12,
    light: true,
    weapons: [
      { name: "Light MG", damage: 2, rangeMin: 0, rangeMax: 4, accuracy: 0.6, suppression: 1, ammoMax: 12, indirect: false, penetration: 2 },
    ],
  },
  artillery: {
    id: "artillery",
    name: "SP Artillery",
    cls: "artillery",
    armor: { front: 2, side: 2, rear: 1 },
    structure: 8,
    move: 3,
    fuelMax: 22,
    vision: 3,
    light: false,
    weapons: [
      { name: "155mm", damage: 7, rangeMin: 4, rangeMax: 34, accuracy: 0.5, suppression: 6, ammoMax: 6, indirect: true, penetration: 5 },
    ],
  },
  armor: {
    id: "armor",
    name: "Main Battle Tank",
    cls: "armor",
    armor: { front: 7, side: 4, rear: 2 },
    structure: 16,
    move: 6,
    fuelMax: 36,
    vision: 7,
    light: false,
    weapons: [
      { name: "120mm Gun", damage: 7, rangeMin: 0, rangeMax: 13, accuracy: 0.7, suppression: 2, ammoMax: 12, indirect: false, penetration: 9 },
    ],
  },
  infantry: {
    id: "infantry",
    name: "Mech. Infantry",
    cls: "infantry",
    armor: { front: 1, side: 1, rear: 1 },
    structure: 8,
    move: 4,
    fuelMax: 20,
    vision: 5,
    light: true,
    weapons: [
      { name: "AT Team", damage: 5, rangeMin: 0, rangeMax: 4, accuracy: 0.55, suppression: 2, ammoMax: 6, indirect: false, penetration: 7 },
    ],
  },
  supply: {
    id: "supply",
    name: "Supply Vehicle",
    cls: "supply",
    armor: { front: 1, side: 1, rear: 1 },
    structure: 6,
    move: 5,
    fuelMax: 44,
    vision: 4,
    light: false,
    supplyCapacity: 30,
    weapons: [],
  },
};

export function unitType(id: string): UnitType {
  const u = UNITS[id];
  if (!u) throw new Error(`unknown unit type '${id}'`);
  return u;
}
