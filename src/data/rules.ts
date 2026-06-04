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

  // Mech commander utility AI (the player's influence surface). Thresholds below
  // which a mech needs to break contact; weights for scoring candidate moves.
  commander: {
    ammoLow: 0.34, // ammo fraction under which resupply pressure builds
    fuelLow: 0.25,
    structLow: 0.4,
    needTrigger: 0.34, // sustainment need above which the stance becomes "resupply"
    wObjective: 3, // pull toward the (nearest) objective-zone hex
    wSeize: 60, // taking an open zone hex wins — it dominates everything else
    wSupply: 4, // pull toward supply, scaled by need
    wThreat: 1.2, // push away from exposure
    wAttack: 5, // pull toward a shot on a degraded enemy
    coverExposureReduction: 0.18, // per cover point, how much exposure drops
    supportReduction: 0.22, // per nearby friendly support unit
    supportRadius: 3,
    fogCaution: 2.6, // exposure added for advancing into UNSCOUTED hexes (no recon → cautious)
    memoryTurns: 4, // how long a last-known enemy sighting is remembered after losing sight
  },
} as const;
