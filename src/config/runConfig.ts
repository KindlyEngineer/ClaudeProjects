import { PLAYER_MAX_HP, PLAYER_SPEED } from "./balance";

// A run is parameterized by a RunConfig. This is the seam for the eventual
// main-menu flow (theme selection → character selection → gameplay): the menu
// will build a RunConfig and hand it to startRun(). For now there is exactly
// one default theme and one default character — no selection UI yet.

/** A "level theme": which tile-chunk set to assemble from + how it looks. */
export interface ThemeDef {
  readonly name: string;
  /** Names of chunk templates this theme draws from (see sim/levelGen). */
  readonly chunks: readonly string[];
  /** Relative odds of an empty/open chunk, biasing arenas toward open space. */
  readonly openBias: number;
  readonly palette: {
    readonly sky: number;
    readonly fog: number;
    readonly floor: number;
    readonly wall: number;
    readonly cover: number;
    readonly hazard: number; // emissive danger tiles
  };
}

/** A playable character: starting stats. (Weapons/abilities expand later.) */
export interface CharacterDef {
  readonly name: string;
  readonly maxHp: number;
  readonly moveSpeed: number;
}

export const FOUNDRY: ThemeDef = {
  name: "Foundry",
  chunks: ["open", "pillars", "barrier", "crates", "hazard", "elbow"],
  openBias: 3,
  palette: {
    sky: 0x0b0d12,
    fog: 0x0b0d12,
    floor: 0x2b3242,
    wall: 0x55617a,
    cover: 0x6b5942,
    hazard: 0xff5a3c,
  },
};

export const DEFAULT_CHARACTER: CharacterDef = {
  name: "Drifter",
  maxHp: PLAYER_MAX_HP,
  moveSpeed: PLAYER_SPEED,
};

export function defaultRunConfig(seed = 1): RunConfig {
  return { seed, theme: FOUNDRY, character: DEFAULT_CHARACTER };
}

export interface RunConfig {
  readonly seed: number;
  readonly theme: ThemeDef;
  readonly character: CharacterDef;
}
