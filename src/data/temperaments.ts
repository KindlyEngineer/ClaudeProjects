// Commander temperaments (M3, ruling D3): each call sign carries a PERSONALITY
// — a preset of utility-weight multipliers plus a voice. The same machine
// plays and TALKS differently under a different name: Saber overextends,
// Vanguard plots the supply line first, Reaper hunts mistakes. Fallibility
// stops being noise and becomes character. Pure data — tune a row, change a
// commander.

export interface Temperament {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** Multipliers applied to the mech's utility weights (keys = consideration
   *  names in sim/ai.ts; unknown keys are ignored). */
  readonly weightMul: Readonly<Record<string, number>>;
  /** Voice overrides for the intent banner, by stance. */
  readonly voice: {
    readonly deploy: string; // spoken while the player places the echelon
    readonly advance?: string;
    readonly assault?: string;
    readonly hold?: string;
    readonly resupply?: string;
  };
}

export const TEMPERAMENTS: Record<string, Temperament> = {
  bold: {
    id: "bold",
    name: "Bold",
    blurb: "Pushes hard, accepts exposure, hates waiting.",
    weightMul: { objective: 1.25, exposure: 0.6, attack: 1.3 },
    voice: {
      deploy: "Put the fuel where I can reach it — I won't be waiting.",
      advance: "Straight at them — keep up",
      assault: "Through them. NOW.",
      hold: "Holding — under protest",
      resupply: "Topping off — make it fast",
    },
  },
  methodical: {
    id: "methodical",
    name: "Methodical",
    blurb: "Bounds, cover, margins. Wins slowly, loses rarely.",
    weightMul: { exposure: 1.35, cover: 1.3, standoff: 1.2 },
    voice: {
      deploy: "Plot the supply line first. Then we move.",
      advance: "Advancing by bounds",
      assault: "Executing the assault — as planned",
      hold: "Holding good ground",
      resupply: "Breaking contact to resupply — by the book",
    },
  },
  opportunist: {
    id: "opportunist",
    name: "Opportunist",
    blurb: "Hunts flanks, heights and mistakes.",
    weightMul: { attack: 1.4, highGround: 1.5, mutual: 0.8 },
    voice: {
      deploy: "Find me a flank and I'll find you a victory.",
      advance: "Working the seams",
      assault: "There's the opening — exploiting",
      hold: "Waiting for their mistake",
      resupply: "Refitting — keep them busy",
    },
  },
};

/** Call sign → temperament (deterministic; the name IS the personality). */
const BY_SIGN: Record<string, string> = {
  Vanguard: "methodical",
  Saber: "bold",
  Reaper: "opportunist",
  Warden: "methodical",
  Talon: "bold",
  Ronin: "opportunist",
  Halberd: "methodical",
  Cobra: "bold",
};

export function temperamentOf(callSign: string | undefined): Temperament | undefined {
  if (!callSign) return undefined;
  const id = BY_SIGN[callSign];
  return id ? TEMPERAMENTS[id] : undefined;
}
