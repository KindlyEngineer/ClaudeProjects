import type { UnitType } from "./types";

// Unit table. One uniform combat model across all classes (brief §2): armour by
// facing + structure + COMPONENT damage (M2.5). Every unit declares its
// components — what a penetrating crit can actually break — and the effects map
// onto the same shared states (mobility / sensors / crew) or disable a SPECIFIC
// weapon mount. Differentiation by capability and sustainment, never bespoke
// systems. Everything here is data — add a row to add a unit.

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
    components: [
      { id: "ac_mount", name: "Autocannon mount", effect: "weapon", weaponIndex: 0 },
      { id: "srm_rack", name: "SRM rack", effect: "weapon", weaponIndex: 1 },
      { id: "actuators", name: "Leg actuators", effect: "mobility" },
      { id: "sensors", name: "Sensor mast", effect: "sensors" },
      { id: "cockpit", name: "Cockpit", effect: "crew" },
    ],
  },

  mech_scout: {
    id: "mech_scout",
    name: "Scout Mech",
    cls: "mech",
    armor: { front: 5, side: 4, rear: 3 },
    structure: 20,
    move: 6,
    fuelMax: 36,
    vision: 8,
    light: true,
    weapons: [
      { name: "Light Autocannon", damage: 5, rangeMin: 0, rangeMax: 9, accuracy: 0.72, suppression: 2, ammoMax: 12, indirect: false, penetration: 6 },
    ],
    components: [
      { id: "lac_mount", name: "Autocannon mount", effect: "weapon", weaponIndex: 0 },
      { id: "actuators", name: "Leg actuators", effect: "mobility" },
      { id: "optics", name: "Recon optics", effect: "sensors" },
      { id: "cockpit", name: "Cockpit", effect: "crew" },
    ],
  },

  // A fire-support mech: indirect LRM racks — the commander's own artillery
  // (M2.5 variety; also widens the requisition pool).
  mech_fire: {
    id: "mech_fire",
    name: "Fire-Support Mech",
    cls: "mech",
    armor: { front: 7, side: 5, rear: 3 },
    structure: 24,
    move: 4,
    fuelMax: 26,
    vision: 7,
    light: false,
    weapons: [
      { name: "LRM Rack", damage: 6, rangeMin: 5, rangeMax: 16, accuracy: 0.6, suppression: 4, ammoMax: 10, indirect: true, penetration: 5 },
      { name: "Light Autocannon", damage: 4, rangeMin: 0, rangeMax: 8, accuracy: 0.65, suppression: 2, ammoMax: 8, indirect: false, penetration: 5 },
    ],
    components: [
      { id: "lrm_rack", name: "LRM rack", effect: "weapon", weaponIndex: 0 },
      { id: "lac_mount", name: "Autocannon mount", effect: "weapon", weaponIndex: 1 },
      { id: "actuators", name: "Leg actuators", effect: "mobility" },
      { id: "sensors", name: "Fire-control sensors", effect: "sensors" },
      { id: "cockpit", name: "Cockpit", effect: "crew" },
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
    components: [
      { id: "mg", name: "MG mount", effect: "weapon", weaponIndex: 0 },
      { id: "wheels", name: "Drivetrain", effect: "mobility" },
      { id: "mast", name: "Sensor mast", effect: "sensors" },
      { id: "crew", name: "Crew cab", effect: "crew" },
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
    components: [
      { id: "tube", name: "155mm tube", effect: "weapon", weaponIndex: 0 },
      { id: "tracks", name: "Tracks", effect: "mobility" },
      { id: "fcs", name: "Fire-direction gear", effect: "sensors" },
      { id: "crew", name: "Gun crew", effect: "crew" },
    ],
  },
  // A cheap, short-legged tube the player can push forward (M2.5 variety).
  mortar_team: {
    id: "mortar_team",
    name: "Mortar Team",
    cls: "artillery",
    armor: { front: 1, side: 1, rear: 1 },
    structure: 6,
    move: 3,
    fuelMax: 18,
    vision: 4,
    light: true,
    weapons: [
      { name: "81mm Mortar", damage: 5, rangeMin: 3, rangeMax: 12, accuracy: 0.55, suppression: 5, ammoMax: 8, indirect: true, penetration: 4 },
    ],
    components: [
      { id: "tube", name: "Mortar tube", effect: "weapon", weaponIndex: 0 },
      { id: "legs", name: "Bearers", effect: "mobility" },
      { id: "crew", name: "Crew", effect: "crew" },
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
    components: [
      { id: "gun", name: "Main gun", effect: "weapon", weaponIndex: 0 },
      { id: "tracks", name: "Tracks", effect: "mobility" },
      { id: "optics", name: "Gunner's optics", effect: "sensors" },
      { id: "crew", name: "Crew compartment", effect: "crew" },
    ],
  },
  // The breakthrough hammer: slow, expensive, hard to stop frontally (M2.5).
  heavy_tank: {
    id: "heavy_tank",
    name: "Heavy Tank",
    cls: "armor",
    armor: { front: 10, side: 6, rear: 3 },
    structure: 22,
    move: 4,
    fuelMax: 30,
    vision: 6,
    light: false,
    weapons: [
      { name: "140mm Gun", damage: 9, rangeMin: 0, rangeMax: 12, accuracy: 0.65, suppression: 3, ammoMax: 10, indirect: false, penetration: 10 },
    ],
    components: [
      { id: "gun", name: "140mm gun", effect: "weapon", weaponIndex: 0 },
      { id: "tracks", name: "Tracks", effect: "mobility" },
      { id: "optics", name: "Gunner's optics", effect: "sensors" },
      { id: "crew", name: "Crew compartment", effect: "crew" },
    ],
  },
  // Air denial: an umbrella that contests off-map strikes (M2.5 — the counter
  // to the air game; resolution in sim/offmap.ts, numbers in RULES.aa).
  aa_vehicle: {
    id: "aa_vehicle",
    name: "SP Anti-Air",
    cls: "aa",
    armor: { front: 3, side: 2, rear: 2 },
    structure: 10,
    move: 5,
    fuelMax: 30,
    vision: 8,
    light: false,
    weapons: [
      { name: "Flak Cannons", damage: 4, rangeMin: 0, rangeMax: 6, accuracy: 0.6, suppression: 3, ammoMax: 12, indirect: false, penetration: 4 },
    ],
    components: [
      { id: "flak", name: "Flak cannons", effect: "weapon", weaponIndex: 0 },
      { id: "radar", name: "Search radar", effect: "sensors" },
      { id: "tracks", name: "Drivetrain", effect: "mobility" },
      { id: "crew", name: "Crew", effect: "crew" },
    ],
  },
  // Electronic warfare (H2, D15): no gun at all — its weapons are the enemy's
  // sensors (jam umbrella) and the enemy's belief map (decoy charges). Numbers
  // in RULES.ew; resolution in sim/vision.ts (jam) and sim/actions.ts (decoys).
  ew_vehicle: {
    id: "ew_vehicle",
    name: "EW Track",
    cls: "ew",
    armor: { front: 3, side: 2, rear: 2 },
    structure: 9,
    move: 5,
    fuelMax: 30,
    vision: 9,
    light: true,
    ewCharges: 2,
    weapons: [],
    components: [
      { id: "suite", name: "EW suite", effect: "sensors" }, // the suite IS the weapon — break it and the unit goes quiet
      { id: "tracks", name: "Drivetrain", effect: "mobility" },
      { id: "crew", name: "Operators", effect: "crew" },
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
    components: [
      { id: "at", name: "AT launchers", effect: "weapon", weaponIndex: 0 },
      { id: "carrier", name: "Carrier", effect: "mobility" },
      { id: "squad", name: "Squad", effect: "crew" },
    ],
  },
  // Long-arm overwatch denial: few missiles, each one matters (M2.5).
  atgm_team: {
    id: "atgm_team",
    name: "ATGM Team",
    cls: "infantry",
    armor: { front: 1, side: 1, rear: 1 },
    structure: 6,
    move: 3,
    fuelMax: 16,
    vision: 8,
    light: true,
    weapons: [
      { name: "ATGM", damage: 7, rangeMin: 2, rangeMax: 9, accuracy: 0.65, suppression: 1, ammoMax: 4, indirect: false, penetration: 10 },
    ],
    components: [
      { id: "launcher", name: "Missile launcher", effect: "weapon", weaponIndex: 0 },
      { id: "legs", name: "Bearers", effect: "mobility" },
      { id: "crew", name: "Crew", effect: "crew" },
    ],
  },
  engineer: {
    id: "engineer",
    name: "Combat Engineers",
    cls: "engineer",
    armor: { front: 3, side: 2, rear: 2 },
    structure: 10,
    move: 4,
    fuelMax: 22,
    vision: 4,
    light: true,
    weapons: [
      { name: "Demo Charges", damage: 6, rangeMin: 0, rangeMax: 2, accuracy: 0.6, suppression: 2, ammoMax: 8, indirect: false, penetration: 8 },
    ],
    components: [
      { id: "charges", name: "Demolition kit", effect: "weapon", weaponIndex: 0 },
      { id: "carrier", name: "Carrier", effect: "mobility" },
      { id: "sappers", name: "Sapper squad", effect: "crew" },
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
    components: [
      { id: "wheels", name: "Drivetrain", effect: "mobility" },
      { id: "cargo", name: "Cargo bed", effect: "crew" },
    ],
  },
  // The deep-operation hauler: more capacity, slower, a fatter target (M2.5).
  heavy_supply: {
    id: "heavy_supply",
    name: "Heavy Hauler",
    cls: "supply",
    armor: { front: 2, side: 1, rear: 1 },
    structure: 9,
    move: 4,
    fuelMax: 40,
    vision: 4,
    light: false,
    supplyCapacity: 60,
    weapons: [],
    components: [
      { id: "wheels", name: "Drivetrain", effect: "mobility" },
      { id: "cargo", name: "Cargo beds", effect: "crew" },
    ],
  },
};

export function unitType(id: string): UnitType {
  const u = UNITS[id];
  if (!u) throw new Error(`unknown unit type '${id}'`);
  return u;
}
