import type { Hex } from "../../sim/hex";
import type { MapDef, UnitPlacement } from "../types";
import { E, W, generateCells, offsetToAxial, place } from "./gen";

// "Rearguard" — the withdrawal lesson, and the M2.5 showcase. A SMALL blue
// detachment (no assault mech — a scout, a mortar, engineers) must hold a
// village for twelve turns against a heavy red echelon led by a HEAVY TANK,
// with red air overhead and a red AA umbrella deep behind. Everything the
// player has learned at once: mine the approaches, fortify, screen with the
// mortar's smoke, spend the one overflight well.

const COLS = 28;
const ROWS = 18;

const OBJ: Array<[number, number]> = [
  [7, 8],
  [8, 8],
  [7, 9],
  [8, 9],
];
const isObj = (c: number, r: number) => OBJ.some(([oc, or]) => oc === c && or === r);

const cells = generateCells({
  cols: COLS,
  rows: ROWS,
  seed: 0x6ea64,
  terrain: (c, r) => (isObj(c, r) ? "urban" : undefined),
});

const units: UnitPlacement[] = [
  // Blue: the rearguard — thin, clever, dug in or dead.
  place("mech_scout", "blue", 8, 9, E, "ai"),
  place("infantry", "blue", 9, 8, E, "player"),
  place("atgm_team", "blue", 10, 9, E, "player"),
  place("engineer", "blue", 8, 10, E, "player"),
  place("mortar_team", "blue", 5, 9, E, "player"),
  place("supply", "blue", 4, 8, E, "player"),

  // Red: the pursuit — heavy armour up front, guns and air behind.
  place("recon", "red", 22, 8, W),
  place("heavy_tank", "red", 25, 9, W),
  place("armor", "red", 25, 6, W),
  place("mech_assault", "red", 26, 10, W),
  place("infantry", "red", 24, 7, W),
  place("infantry", "red", 24, 11, W),
  place("artillery", "red", 27, 8, W),
  place("aa_vehicle", "red", 26, 7, W),
  place("supply", "red", 27, 10, W),
];

const zone: Hex[] = OBJ.map(([c, r]) => offsetToAxial(c, r));

export const MAP06: MapDef = {
  name: "Rearguard",
  hexSize: 1,
  cells,
  units,
  objective: { kind: "seize", turnLimit: 12, zone, attacker: "red" }, // hold until relieved
  commanderSkill: { blue: 1.0, red: 0.7 },
  offmap: { blue: { recon: 1 }, red: { strike: 1, recon: 1 } },
};
