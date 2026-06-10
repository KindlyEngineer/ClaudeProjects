import type { TerrainType } from "./types";

// Terrain table — palette desaturated to planning-display field tones (UI-4).
// In v0 elevation is purely visual (the 2.5D heightmap); the
// mechanical "approach exposure" the commander reads comes from terrain *type*
// (cover) here. moveCost/cover feed logistics and combat in later slices.

export const TERRAIN: Record<string, TerrainType> = {
  open: { id: "open", name: "Open", color: 0x57614c, moveCost: 1, cover: 0, blocksLineOfSight: false },
  road: { id: "road", name: "Road", color: 0x6e675a, moveCost: 0.5, cover: 0, blocksLineOfSight: false },
  woods: { id: "woods", name: "Woods", color: 0x36422f, moveCost: 2, cover: 2, blocksLineOfSight: true },
  hill: { id: "hill", name: "Hillside", color: 0x6a6149, moveCost: 2, cover: 1, blocksLineOfSight: false },
  urban: { id: "urban", name: "Urban", color: 0x5c5c63, moveCost: 1, cover: 3, blocksLineOfSight: true },
  water: { id: "water", name: "Water", color: 0x2c3d4d, moveCost: Infinity, cover: 0, blocksLineOfSight: false },
};

export function terrain(id: string): TerrainType {
  const t = TERRAIN[id];
  if (!t) throw new Error(`unknown terrain '${id}'`);
  return t;
}
