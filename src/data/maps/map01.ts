import type { Direction, Hex } from "../../sim/hex";
import type { MapCell, MapDef, UnitPlacement } from "../types";

// "Ridge Approach" — the v0 handcrafted map. A blue force (player support + one
// AI mech) advances west→east to seize an urban zone held by a red detachment,
// across an undulating ridge. Built as data: a parallelogram of hexes, each with
// a terrain type and an elevation (the visual heightmap), plus unit placements
// and a Seize objective. Authored programmatically but fully data — no sim code
// references this map by name.

const COLS = 12; // q: 0..11
const ROWS = 9; // r: 0..8

/** Smooth elevation field → the continuous heightmap look (visual in v0). */
function elevationAt(q: number, r: number): number {
  const ridge = Math.sin((q / COLS) * Math.PI * 1.3) * 1.6; // a diagonal ridge
  const roll = Math.cos((r / ROWS) * Math.PI * 2) * 0.6;
  const bump = Math.sin((q + r) * 0.9) * 0.25; // gentle local texture
  return Math.max(0, ridge + roll + bump + 1.2);
}

function terrainAt(q: number, r: number): string {
  // A road threads west→east along the middle rows.
  if (r === 4 && q < 9) return "road";
  // Urban objective cluster in the east.
  if (q >= 8 && q <= 10 && r >= 3 && r <= 5) return "urban";
  // A woods belt screening the centre.
  if (q >= 4 && q <= 5 && r >= 1 && r <= 6) return "woods";
  // A small pond.
  if (q === 2 && (r === 6 || r === 7)) return "water";
  // Higher ground reads as hillside.
  if (elevationAt(q, r) > 2.4) return "hill";
  return "open";
}

function buildCells(): MapCell[] {
  const cells: MapCell[] = [];
  for (let q = 0; q < COLS; q++) {
    for (let r = 0; r < ROWS; r++) {
      cells.push({ hex: { q, r }, terrain: terrainAt(q, r), elevation: elevationAt(q, r) });
    }
  }
  return cells;
}

const E: Direction = 0; // facing east (toward the objective)
const W: Direction = 3; // facing west (defenders look back at the approach)

const units: UnitPlacement[] = [
  // Blue: one AI mech (main effort) + the player's support/logistics effort.
  { type: "mech_assault", side: "blue", hex: { q: 1, r: 4 }, facing: E },
  { type: "recon", side: "blue", hex: { q: 1, r: 2 }, facing: E },
  { type: "armor", side: "blue", hex: { q: 0, r: 5 }, facing: E },
  { type: "infantry", side: "blue", hex: { q: 0, r: 3 }, facing: E },
  { type: "artillery", side: "blue", hex: { q: 0, r: 6 }, facing: E },
  { type: "supply", side: "blue", hex: { q: 0, r: 4 }, facing: E },

  // Red: a detachment dug in around the urban objective.
  { type: "mech_assault", side: "red", hex: { q: 9, r: 4 }, facing: W },
  { type: "infantry", side: "red", hex: { q: 9, r: 3 }, facing: W },
  { type: "armor", side: "red", hex: { q: 10, r: 5 }, facing: W },
  { type: "supply", side: "red", hex: { q: 11, r: 4 }, facing: W },
];

const zone: Hex[] = [
  { q: 9, r: 4 },
  { q: 9, r: 3 },
  { q: 9, r: 5 },
  { q: 10, r: 4 },
];

export const MAP01: MapDef = {
  name: "Ridge Approach",
  hexSize: 1,
  cells: buildCells(),
  units,
  objective: { kind: "seize", turnLimit: 14, zone, attacker: "blue" },
};
