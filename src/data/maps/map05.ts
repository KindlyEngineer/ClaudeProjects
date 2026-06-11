import type { Hex } from "../../sim/hex";
import type { MapDef, UnitPlacement } from "../types";
import { E, W, generateCells, offsetToAxial, place } from "./gen";

// "Causeway" — the smoke lesson. A river cuts the board; the only ways east are
// two narrow causeways, both under the guns of the far bank. Nobody crosses
// open water under observation — screen a crossing with smoke (or buy an
// overflight and suppress the overwatch) and the door opens.

const COLS = 32;
const ROWS = 20;

const RIVER_COLS = [15, 16, 17];
const CAUSEWAYS: Array<[number, number]> = []; // [col,row] kept dry
for (const col of RIVER_COLS) {
  CAUSEWAYS.push([col, 5], [col, 6], [col, 14], [col, 15]);
}
const isRiver = (c: number, r: number) =>
  RIVER_COLS.includes(c) && !CAUSEWAYS.some(([cc, cr]) => cc === c && cr === r);

const OBJ: Array<[number, number]> = [
  [24, 9],
  [25, 9],
  [24, 10],
  [25, 10],
];
const isObj = (c: number, r: number) => OBJ.some(([oc, or]) => oc === c && or === r);

const cells = generateCells({
  cols: COLS,
  rows: ROWS,
  seed: 0x51e7a,
  // The river valley sits low; the far bank rises (overwatch wants the height).
  shape: (c, _r, base) => (RIVER_COLS.includes(c) ? base * 0.25 : c > 17 && c < 24 ? base * 0.9 + 0.12 : base),
  terrain: (c, r) => (isObj(c, r) ? "urban" : isRiver(c, r) ? "water" : CAUSEWAYS.some(([cc, cr]) => cc === c && cr === r) ? "road" : undefined),
});

const units: UnitPlacement[] = [
  // Blue: the crossing force.
  place("mech_assault", "blue", 1, 9, E, "ai"),
  place("mech_scout", "blue", 1, 12, E, "ai"),
  place("recon", "blue", 2, 6, E, "player"),
  place("armor", "blue", 1, 14, E, "player"),
  place("infantry", "blue", 0, 8, E, "player"),
  place("engineer", "blue", 0, 13, E, "player"),
  place("artillery", "blue", 0, 11, E, "player"),
  place("supply", "blue", 0, 10, E, "player"),

  // Red: far-bank overwatch on both causeways + a reserve at the town.
  place("infantry", "red", 19, 6, W),
  place("armor", "red", 20, 5, W),
  place("infantry", "red", 19, 14, W),
  place("armor", "red", 20, 15, W),
  place("mech_assault", "red", 23, 10, W),
  place("engineer", "red", 24, 8, W),
  place("artillery", "red", 27, 10, W),
  place("supply", "red", 28, 9, W),
];

const zone: Hex[] = OBJ.map(([c, r]) => offsetToAxial(c, r));

export const MAP05: MapDef = {
  name: "Causeway",
  hexSize: 1,
  cells,
  units,
  objective: { kind: "seize", turnLimit: 22, zone, attacker: "blue" }, // +2 turns for the mud (M4 balance pass)
  commanderSkill: { blue: 1.0, red: 0.7 },
  offmap: { blue: { strike: 1, recon: 1 }, red: { recon: 1 } },
  weather: "rain", // mud off the causeways; the far bank vanishes into the wet
};
