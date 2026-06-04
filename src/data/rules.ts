// Combat tuning constants — data, not code branches, so balance is one place.
// (Per-unit/weapon numbers live in units.ts; these are the shared resolution
// rules the uniform combat model applies to everyone.)

export const RULES = {
  // To-hit modifiers.
  coverHitPenalty: 0.06, // per point of terrain cover on the target
  suppressionHitPenalty: 0.04, // per point of suppression on the attacker
  minHit: 0.05,
  maxHit: 0.95,

  // Crits (rolled only on a penetrating hit).
  baseCritChance: 0.25,
  lowStructureFraction: 0.3, // "wounded": structure below this fraction of max
  lowStructureCritBonus: 0.25,

  // Suppression / morale.
  suppressionBreak: 8, // reaching this inflicts a "shaken" crit (morale break)
  suppressionDecayPerTurn: 3, // recovered each turn the unit isn't hit

  // Logistics dry-out (consecutive turns cut off from a supply source).
  dryMoveTurns: 2, // ≥ this many dry turns → movement points halved
  dryFireTurns: 3, // ≥ this many dry turns → cannot fire (rationing what's left)
} as const;
