import { HIGH_GROUND_MAX, HIGH_GROUND_MIN, HIGH_GROUND_PER_UNIT } from "../config/balance";
import { clamp } from "../core/math";

// High-ground combat rule: attacking a target below you hits harder; attacking
// uphill is penalized. Pure function of the height delta so it's unit-testable.
export function highGroundMultiplier(shooterY: number, targetY: number): number {
  return clamp(1 + HIGH_GROUND_PER_UNIT * (shooterY - targetY), HIGH_GROUND_MIN, HIGH_GROUND_MAX);
}
