import { RULES } from "../data/rules";

// Trust (Horizon 2, ruling D13): the relationship made mechanical. Each call
// sign carries a 0..100 confidence in the player's support, earned from what
// was actually delivered across the operation (see operation.ts for the
// ledger). Here live the pure reads: the band a number falls in and the
// utility-weight multipliers that band applies — the same legible mechanism
// temperament uses, layered after it. A unit with NO trust value (every
// skirmish) is STEADY: no history, no grudge.

export type TrustBand = "WARY" | "STEADY" | "ASSURED";

export function trustBand(trust: number | undefined): TrustBand {
  if (trust === undefined) return "STEADY";
  if (trust < RULES.trust.waryBelow) return "WARY";
  if (trust > RULES.trust.assuredAbove) return "ASSURED";
  return "STEADY";
}

/** Weight multipliers a trust band applies (keys = consideration names in
 *  sim/ai.ts). STEADY is the identity — trust only speaks at the edges. */
export function trustWeightMul(band: TrustBand): Readonly<Record<string, number>> {
  if (band === "WARY") return RULES.trust.wary;
  if (band === "ASSURED") return RULES.trust.assured;
  return {};
}

export function clampTrust(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}
