// ============================================================
// IMPACT MAGNITUDE
// Converts a raw gameplay number (knockback force, wall-impact speed
// delta, landing intensity) into a normalized 0..1 "how big a deal is
// this" magnitude, driving camera shake/hitstop/FOV punch and VFX scale.
//
// Implements the owner-approved "Hybrid scalable" (profile C) direction
// (2026-09-25): an ease-in curve (exponent > 1) so small/routine values
// stay well below a linear mapping — nothing "explodes" from a light tap —
// while values approaching the reference max escalate quickly. A few
// event kinds (KO, ring-out, Stability Break, Perfect Dodge) always carry
// a fixed floor magnitude regardless of the exact numbers involved, since
// those are always meant to read as a genuine moment, not scale down just
// because the specific hit that caused them was modest.
//
// All reference values are Milestone 4 engineering placeholders (GDD
// section 167), picked from Milestone 2/3's own tuning ranges (see
// AttackTuning/KnockbackTuning/MovementTuning) — not a GDD-approved exact
// balance number.
// ============================================================

// Milestone 2's knockback `force` (see Knockback.ts) realistically ranges
// from ~3 (a weak Circular hit against a fast, high-Stability defender) to
// ~60+ (a maxed Dash Attack landing head-on) — this is the force value
// that reads as "as big as it gets" for camera/VFX purposes.
const KNOCKBACK_FORCE_REFERENCE_FOR_MAGNITUDE_1 = 35;
const KNOCKBACK_MAGNITUDE_EASE_EXPONENT = 1.8;

// DriftController's landingIntensity is already 0..1 — this only reshapes
// it so a weak landing reads as even more subtle than the raw value.
const LANDING_MAGNITUDE_EASE_EXPONENT = 1.3;

// A wall/floor bounce's impactDeltaSpeedMps, relative to
// INTENDED_MAX_SPEED_MPS (11) — roughly "almost top speed, dead stop".
const MOVEMENT_IMPACT_REFERENCE_MPS_FOR_MAGNITUDE_1 = 9;
const MOVEMENT_IMPACT_EASE_EXPONENT = 1.6;

/** Always a genuine moment regardless of the exact Stability-damage number that crossed zero. */
export const STABILITY_BREAK_MAGNITUDE = 0.75;
/** The biggest moment there is. */
export const KO_MAGNITUDE = 1.0;
export const RING_OUT_MAGNITUDE = 0.9;
/**
 * Presentation-only camera/VFX emphasis for a Perfect Dodge — not a
 * gameplay reward (that remains unimplemented pending owner approval, per
 * the Milestone 3 review). Slow-motion/afterimage/camera-emphasis
 * feedback was explicitly called out as natural Milestone 4 game-feel
 * work, distinct from an offensive bonus.
 */
export const PERFECT_DODGE_MAGNITUDE = 0.55;
/** A clean whiff-save — some feedback, but subtle; not a moment on its own. */
export const DODGED_MAGNITUDE = 0.2;
/** A Clash (Milestone 5) resolving is always a genuine moment, regardless of the exact ClashPower numbers involved — strong enough to trigger camera hitstop/shake before the real physical knockback plays out. */
export const CLASH_RESOLVED_MAGNITUDE = 0.9;

function easeInMagnitude(rawValue: number, referenceValueForMagnitude1: number, exponent: number): number {
  const t = Math.max(0, Math.min(1, rawValue / referenceValueForMagnitude1));
  return Math.pow(t, exponent);
}

export function knockbackMagnitude(force: number): number {
  return easeInMagnitude(force, KNOCKBACK_FORCE_REFERENCE_FOR_MAGNITUDE_1, KNOCKBACK_MAGNITUDE_EASE_EXPONENT);
}

export function landingMagnitude(landingIntensity: number): number {
  return easeInMagnitude(landingIntensity, 1, LANDING_MAGNITUDE_EASE_EXPONENT);
}

export function movementImpactMagnitude(speedDeltaMps: number): number {
  return easeInMagnitude(speedDeltaMps, MOVEMENT_IMPACT_REFERENCE_MPS_FOR_MAGNITUDE_1, MOVEMENT_IMPACT_EASE_EXPONENT);
}
