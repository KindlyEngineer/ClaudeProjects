// Battlefield-effect table — transient or built terrain modifiers (smoke,
// fortifications). Data, not code branches: an effect declares how it changes
// the ground (sight / movement / cover) and how long it lasts; the sim's shared
// terrain queries (sim/effects.ts) apply whatever stands on a hex, so EVERY
// consumer — movement, combat, vision, the AI's own scoring — accounts for
// effects automatically. Add a row to add an effect.

export type EffectId = "smoke" | "fortification";

export interface EffectDef {
  readonly id: EffectId;
  readonly name: string;
  readonly blocksLineOfSight: boolean;
  readonly moveCostDelta: number; // added to the terrain's move cost
  readonly cover: number; // added to the terrain's cover
  readonly duration: number | null; // turns until it dissipates; null = permanent
}

export const EFFECTS: Record<EffectId, EffectDef> = {
  smoke: { id: "smoke", name: "Smoke", blocksLineOfSight: true, moveCostDelta: 0, cover: 0, duration: 2 },
  fortification: { id: "fortification", name: "Fortification", blocksLineOfSight: false, moveCostDelta: 2, cover: 2, duration: null },
};

export function effectDef(id: EffectId): EffectDef {
  return EFFECTS[id];
}
