import { PLAYER_MAX_HP, PLAYER_SPEED } from "./balance";

// A run is parameterized by a RunConfig. This is the seam for the eventual
// main-menu flow (theme selection → character selection → gameplay): the menu
// will build a RunConfig and hand it to startRun(). For now there is exactly
// one default theme and one default character — no selection UI yet.

/** Terrain generation + look for a "level theme". */
export interface ThemeDef {
  readonly name: string;
  readonly terrain: {
    readonly amplitude: number; // peak hill height
    readonly frequency: number; // base noise frequency (smaller = broader hills)
    readonly octaves: number; // fractal detail layers
    readonly plateau: number; // height of the central high-ground plateau
    readonly pits: number; // number of lethal pit craters carved in
  };
  readonly palette: {
    readonly sky: number;
    readonly fog: number;
    readonly low: number; // vertex color at low elevation
    readonly high: number; // vertex color at high elevation
  };
}

/** A playable character: starting stats. (Weapons/abilities expand later.) */
export interface CharacterDef {
  readonly name: string;
  readonly maxHp: number;
  readonly moveSpeed: number;
}

export interface RunConfig {
  readonly seed: number;
  readonly theme: ThemeDef;
  readonly character: CharacterDef;
}

export const HIGHLANDS: ThemeDef = {
  name: "Highlands",
  terrain: { amplitude: 7, frequency: 0.045, octaves: 4, plateau: 6, pits: 3 },
  palette: { sky: 0x0b0d12, fog: 0x0b0d12, low: 0x223047, high: 0x6f8fb8 },
};

export const DEFAULT_CHARACTER: CharacterDef = {
  name: "Drifter",
  maxHp: PLAYER_MAX_HP,
  moveSpeed: PLAYER_SPEED,
};

export function defaultRunConfig(seed = 1): RunConfig {
  return { seed, theme: HIGHLANDS, character: DEFAULT_CHARACTER };
}
