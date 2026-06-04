import type { CritState } from "./types";

// The shared crit table (brief §2): one small table for every unit. A crit is a
// mission-kill, not a removal — a mobility-killed tank is a stranded problem, a
// sensors-killed unit goes half-blind, a shaken crew may freeze. Data-driven and
// weighted so balance tunes here, not in code.

export interface CritEntry {
  readonly state: CritState;
  readonly weight: number;
}

export const CRIT_TABLE: readonly CritEntry[] = [
  { state: "mobility", weight: 3 }, // engine/track — can't move
  { state: "weapon", weight: 3 }, // main armament knocked out
  { state: "sensors", weight: 2 }, // optics/comms — reduced vision
  { state: "shaken", weight: 2 }, // crew morale break — suppressed/frozen
];

const TOTAL_WEIGHT = CRIT_TABLE.reduce((s, e) => s + e.weight, 0);

/** Map a [0,1) roll onto a crit state by weight. */
export function pickCrit(roll01: number): CritState {
  let x = roll01 * TOTAL_WEIGHT;
  for (const e of CRIT_TABLE) {
    if (x < e.weight) return e.state;
    x -= e.weight;
  }
  return CRIT_TABLE[CRIT_TABLE.length - 1].state;
}
