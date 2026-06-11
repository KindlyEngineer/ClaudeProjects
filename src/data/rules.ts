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

  // Off-map assets (M1): side-level air support, budgeted per battle (scenario
  // allocation + operation Interlude top-ups). Strikes need an OBSERVED target
  // (forward-observer rule); overflights buy a turn of eyes over a corridor.
  offmap: {
    strike: {
      radius: 1, // footprint: target + ring
      accuracy: 0.7, // per-unit to-hit in the footprint
      damage: 7,
      penetration: 7, // vs deck armour (the target's SIDE value)
      suppression: 4, // applied to every enemy in the footprint, hit or miss
    },
    reconFlight: {
      radius: 4, // a corridor's worth of coverage
    },
  },

  // Minefields (M2): laid/cleared by engineers, owner-safe, single-use.
  // Detonation on entry: penetration vs the victim's SIDE armour; movement
  // stops on the struck hex. Known fields (scouted) are routed around.
  mines: {
    damage: 6,
    penetration: 7,
    mobilityCritChance: 0.5, // tracks and legs are what mines eat
  },

  // Weather (M3, ruling D4): battle-wide conditions on the shared queries —
  // the AI adapts through the same vision/movement questions everyone asks.
  weather: {
    clear: { visionDelta: 0, visionFactor: 1, mudCost: 0 },
    rain: { visionDelta: -2, visionFactor: 1, mudCost: 0.5 }, // soft ground off the roads
    night: { visionDelta: 0, visionFactor: 0.5, mudCost: 0 }, // eyes halved (min 2)
  },

  // Electronic warfare (Horizon 2, ruling D15): attacks on the game's defining
  // substrate — the belief map. A living EW unit with its suite intact JAMS:
  // hexes inside its umbrella can only be seen by the enemy at burn-through
  // range (you must close in). Its DECOYS plant a phantom signature in the
  // enemy's belief — reasoned over like any remembered sighting, never
  // fireable (visibleNow stays false), blown the moment the hex is scouted.
  ew: {
    jamRadius: 3, // the umbrella around a living, suite-intact EW unit
    burnThrough: 3, // inside the umbrella, enemy sensors reach only this far
    decoyRange: 6, // how far the EW track can project a phantom
    decoyType: "mech_assault", // the signature it fakes — the scariest one
  },

  // Air defence (M2.5): each living, fire-capable hostile AA unit within
  // `radius` of a strike's target rolls to drive the sortie off (sortie spent,
  // no effect). Overflights fly high and fast — uncontested in v1.
  aa: {
    radius: 3,
    interceptChance: 0.55,
  },

  // Trust (Horizon 2, ruling D13): the commander's per-call-sign confidence in
  // the SUPPORT — earned battle by battle from what the player actually
  // delivered, never asserted. It bends the same utility weights temperament
  // does: a WARY mech hedges (pays more for exposure, leans on the objective
  // less); an ASSURED one commits, because the line behind it has held before.
  // 0..100; skirmishes run neutral (no history, no grudge).
  trust: {
    start: 50,
    waryBelow: 35, // trust under this → the mech hedges
    assuredAbove: 65, // trust over this → the mech commits
    wary: { exposure: 1.3, objective: 0.85 }, // weight multipliers, after temperament
    assured: { exposure: 0.8, objective: 1.15 },
    deltas: {
      win: 8, // the plan worked
      loss: -5, // it didn't
      resupplyEach: 3, // each resupply run that actually reached this mech…
      resupplyCap: 9, // …capped — trust is earned, not farmed
      endedStarved: -10, // ended the battle cut off or bone dry
      mechLost: -4, // a name died; the survivors remember
      unmetRequest: -2, // per REQUEST the depot couldn't answer at refit
      fullRefit: 2, // walked out of the Interlude combat ready
    },
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
