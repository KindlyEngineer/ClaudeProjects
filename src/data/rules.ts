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

  // Elevation (v1 — the heightmap turns mechanical). Heights are the map's raw
  // elevation units (MAP01 amplitude ≈ 4.4). Kept gentle so rolling terrain adds
  // texture and crests matter, without dominating the fight.
  elevation: {
    eyeHeight: 1.4, // a unit sees / is seen from this far above its ground
    losClearance: 0.7, // intervening ground must rise THIS far above the sightline to block it
    hitBonusPerLevel: 0.04, // direct-fire to-hit bonus per elevation unit of height advantage
    hitBonusMax: 0.08, // capped — high ground helps, doesn't auto-win
    climbCostPerLevel: 0.35, // extra MP per elevation unit CLIMBED (descending is free)
  },

  // Logistics dry-out (consecutive turns cut off from a supply source).
  dryMoveTurns: 2, // ≥ this many dry turns → movement points halved
  dryFireTurns: 3, // ≥ this many dry turns → cannot fire (rationing what's left)

  // Indirect-fire missions (area suppression / smoke screens): saturation trades
  // ammo for area — no structure damage, guaranteed pressure. Radius 1 = 7 hexes.
  mission: {
    ammoCost: 2, // rounds expended per mission (SP artillery carries 6)
    radius: 1, // target hex + its ring
  },

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
    // Aggression is EARNED, never assumed (information-gated). A defender goes
    // over to the attack only once it has scouted enough to be confident AND
    // perceives a favourable force ratio.
    counterAdvantage: 1.6, // perceived strength ratio needed to commit a counterattack
    counterHysteresis: 1.2, // stay committed while the ratio holds above this
    minScoutToCommit: 0.45, // fraction of the approach corridor that must be scouted first
    unknownStrength: 26, // assumed hidden enemy strength per fully-unscouted corridor
    assaultAdvantage: 1.5, // attacker commits the assault at this perceived ratio (or once the defence is suppressed)
    // Fallibility (scaled by 1 - skill): commanders aren't perfect.
    satisficeBand: 6, // a fallible commander may pick any move within this of the best
    assessError: 0.35, // ± error a fallible commander makes judging its advantage
  },
} as const;
