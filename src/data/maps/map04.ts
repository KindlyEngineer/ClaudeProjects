import type { Hex } from "../../sim/hex";
import type { MapDef, UnitPlacement } from "../types";
import { E, W, generateCells, offsetToAxial, place } from "./gen";

// "Watchline" — the first DEFENSE (endstate ruling D2: the defender's seat is
// first-class). Blue holds a fortified crossroads on its own side of the board
// against a red combined-arms assault with air support. The player's verbs
// invert: fortify and mine the approaches, screen with smoke, keep the
// counter-punching mech fed. RED is the attacker — blue wins by the clock.

const COLS = 30;
const ROWS = 20;
const MAP_SEED = 0x4a7c1;

const OBJ: Array<[number, number]> = [
  [8, 9],
  [9, 9],
  [8, 10],
  [9, 10],
];
const isObj = (c: number, r: number) => OBJ.some(([oc, or]) => oc === c && or === r);

const cells = generateCells({
  cols: COLS,
  rows: ROWS,
  seed: MAP_SEED,
  terrain: (c, r) => (isObj(c, r) ? "urban" : undefined),
});

const units: UnitPlacement[] = [
  // Blue: the holding force — one mech anchor + a player echelon heavy on
  // engineering and fires (the defensive toolkit).
  place("mech_assault", "blue", 9, 9, E, "ai"),
  place("infantry", "blue", 10, 8, E, "player"),
  place("engineer", "blue", 9, 11, E, "player"),
  place("armor", "blue", 11, 10, E, "player"),
  place("recon", "blue", 13, 9, E, "player"),
  place("artillery", "blue", 5, 10, E, "player"),
  place("supply", "blue", 4, 9, E, "player"),

  // Red: the assault echelon — deeper and heavier, with its own air.
  place("recon", "red", 24, 8, W),
  place("mech_assault", "red", 27, 9, W),
  place("mech_scout", "red", 27, 12, W),
  place("armor", "red", 28, 10, W),
  place("armor", "red", 28, 7, W),
  place("infantry", "red", 26, 11, W),
  place("infantry", "red", 26, 8, W),
  place("artillery", "red", 29, 9, W),
  place("supply", "red", 29, 11, W),
];

const zone: Hex[] = OBJ.map(([c, r]) => offsetToAxial(c, r));

export const MAP04: MapDef = {
  name: "Watchline",
  hexSize: 1,
  cells,
  units,
  objective: { kind: "seize", turnLimit: 16, zone, attacker: "red" }, // BLUE DEFENDS
  commanderSkill: { blue: 1.0, red: 0.7 },
  offmap: { blue: { recon: 1 }, red: { strike: 1, recon: 1 } },
};
