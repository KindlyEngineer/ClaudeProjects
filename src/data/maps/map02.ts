import type { Direction, Hex } from "../../sim/hex";
import type { MapCell, MapDef, UnitPlacement } from "../types";

// "Open Steppe" — a smaller, more open map than Ridge Approach, and a different
// balance: the ATTACKER comes in heavier (two mechs + a full support echelon)
// against a lighter screen. Open ground + superiority give the attack a real
// chance, balancing the set against Ridge's defender-favoured fight. Authored as
// data with a self-contained terrain rule (kept separate from map01 so the proof
// map is untouched).

const COLS = 24;
const ROWS = 14;

function offsetToAxial(col: number, row: number): Hex {
  return { q: col, r: row - Math.floor(col / 2) };
}

function terrainAt(col: number, row: number): string {
  // A couple of woods belts and an urban knot at the objective; mostly open.
  if (col >= 10 && col <= 12 && row >= 5 && row <= 8) return "urban"; // the objective town
  if ((col === 6 || col === 7) && row >= 1 && row <= 5) return "woods";
  if ((col === 16 || col === 17) && row >= 7 && row <= 11) return "woods";
  if (col === 4 && (row === 9 || row === 10)) return "water";
  if (col === 19 && (row === 2 || row === 3)) return "water";
  return "open";
}

function elevationAt(col: number, row: number): number {
  // Gentle visual relief: a low central rise.
  return 1 + Math.max(0, 1.6 - Math.hypot(col - 11, (row - 6.5) * 1.4) * 0.18);
}

function buildCells(): MapCell[] {
  const cells: MapCell[] = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      cells.push({ hex: offsetToAxial(col, row), terrain: terrainAt(col, row), elevation: elevationAt(col, row) });
    }
  }
  return cells;
}

const E: Direction = 0;
const W: Direction = 3;
const place = (type: string, side: "blue" | "red", col: number, row: number, facing: Direction, controller: "ai" | "player" = "ai"): UnitPlacement => ({
  type,
  side,
  hex: offsetToAxial(col, row),
  facing,
  controller,
});

const units: UnitPlacement[] = [
  // Blue: one mech + a full support echelon (incl. a scout-mech screen) — a
  // moderate edge against a light, dug-in defence.
  place("mech_assault", "blue", 1, 6, E, "ai"),
  place("mech_scout", "blue", 1, 8, E, "ai"), // mechs are always AI (the main effort)
  place("recon", "blue", 2, 4, E, "player"),
  place("armor", "blue", 0, 7, E, "player"),
  place("infantry", "blue", 0, 5, E, "player"),
  place("engineer", "blue", 0, 9, E, "player"),
  place("artillery", "blue", 0, 10, E, "player"),
  place("supply", "blue", 0, 6, E, "player"),

  // Red: a light screen dug into the objective town.
  place("mech_assault", "red", 11, 6, W, "ai"),
  place("infantry", "red", 12, 7, W, "ai"),
  place("supply", "red", 14, 6, W, "ai"),
];

const zone: Hex[] = [offsetToAxial(11, 6), offsetToAxial(11, 7), offsetToAxial(12, 6)];

export const MAP02: MapDef = {
  name: "Open Steppe",
  hexSize: 1,
  cells: buildCells(),
  units,
  objective: { kind: "seize", turnLimit: 16, zone, attacker: "blue" },
  commanderSkill: { blue: 1.0, red: 0.65 },
};
