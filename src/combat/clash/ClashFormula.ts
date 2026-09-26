// ============================================================
// CLASH POWER FORMULA
// Pure formula (testable without any state machine) for the GDD-approved
// ClashPower = MashPerformance × StaminaFactor × VelocityFactor.
// Deliberately excludes Attack stat and collision angle — GDD explicitly
// scopes the Clash mini-contest to mash/stamina/velocity only, unlike
// normal knockback (see Knockback.ts) which does use both. Each factor's
// function signature only accepts what the GDD lists, so an
// Attack-stat/angle input can't be silently added later without a visible
// signature change (see clashFormula.test.ts's arity guard).
// ============================================================

import {
  CLASH_MASH_REFERENCE_EVENT_COUNT,
  CLASH_STAMINA_FACTOR_MAX,
  CLASH_STAMINA_FACTOR_MIN,
  CLASH_VELOCITY_FACTOR_MAX,
  CLASH_VELOCITY_FACTOR_MIN,
  CLASH_VELOCITY_REFERENCE_MPS,
} from './ClashTuning';

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/** 0..1, saturating at CLASH_MASH_REFERENCE_EVENT_COUNT mash events. */
export function computeMashPerformance(mashEventCount: number): number {
  return clamp01(mashEventCount / CLASH_MASH_REFERENCE_EVENT_COUNT);
}

/** CLASH_STAMINA_FACTOR_MIN..MAX, from a 0..1 Stamina fraction — never zeroes a combatant out of the Clash entirely, even at 0 Stamina. */
export function computeStaminaFactor(staminaFraction: number): number {
  return lerp(CLASH_STAMINA_FACTOR_MIN, CLASH_STAMINA_FACTOR_MAX, staminaFraction);
}

/** CLASH_VELOCITY_FACTOR_MIN..MAX, from a speed in m/s. */
export function computeVelocityFactor(speedMps: number): number {
  return lerp(CLASH_VELOCITY_FACTOR_MIN, CLASH_VELOCITY_FACTOR_MAX, speedMps / CLASH_VELOCITY_REFERENCE_MPS);
}

/** ClashPower = MashPerformance × StaminaFactor × VelocityFactor (GDD). No Attack stat, no collision angle. */
export function computeClashPower(mashEventCount: number, staminaFraction: number, speedMps: number): number {
  return computeMashPerformance(mashEventCount) * computeStaminaFactor(staminaFraction) * computeVelocityFactor(speedMps);
}
