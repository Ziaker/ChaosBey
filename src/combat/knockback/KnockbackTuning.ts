// ============================================================
// KNOCKBACK — GAMEPLAY TUNING
// Formula components approved by GDD section 27: attack force, attacker
// velocity, defender velocity ("a slower defender is more vulnerable to
// knockback" — explicitly approved rule), defender Defense/Stability/
// Stamina state, collision angle, mass. Attack/Defense archetype stats
// (Milestone 6, GDD section 6/31) are read directly from Knockback.ts's
// KnockbackInput now — see BeyStats.ts.
// All coefficients are Milestone 2 engineering placeholders (GDD section
// 167), bounded to avoid singularities (GDD section 126).
// ============================================================

// Attacker velocity contribution: knockback scales up with how fast the
// attacker was moving, as a fraction of intended max speed.
export const ATTACKER_SPEED_KNOCKBACK_WEIGHT = 0.5;

// Defender-speed vulnerability: bounded lerp, not a division, so near-zero
// defender speed can't create unbounded knockback (GDD section 126) —
// lower speed still increases launch, it just saturates instead of
// exploding.
export const DEFENDER_MAX_VULNERABILITY_AT_ZERO_SPEED = 1.4;
export const DEFENDER_MIN_VULNERABILITY_AT_REFERENCE_SPEED = 0.85;
export const DEFENDER_VULNERABILITY_REFERENCE_SPEED_MPS = 6;

// Defender Stability reduces knockback (a sturdier Bey resists launch);
// at zero Stability, no reduction at all.
export const STABILITY_KNOCKBACK_REDUCTION_AT_FULL = 0.35;

// Low Stamina increases knockback vulnerability (GDD section 30).
export const STAMINA_MAX_KNOCKBACK_VULNERABILITY_BONUS = 0.3;

// Converts the final scalar knockback force into a launch impulse.
export const KNOCKBACK_IMPULSE_PER_FORCE_UNIT = 0.6;
export const KNOCKBACK_UPWARD_LAUNCH_FRACTION = 0.35; // GDD section 27: "upward launch component".

// Collision angle (GDD section 27 explicitly lists this as a knockback
// factor): how aligned the attacker's own motion was with the direction
// of the hit. A hit that lines up with the attacker's charge (e.g. a Dash
// Attack connecting head-on) transfers more force than one where the
// attacker was moving across or away from the defender at the moment of
// contact. A bounded lerp, not a sharp cutoff or a raw dot-product
// multiplier, so there's no discontinuity or singularity as alignment
// crosses zero, and a stationary attacker (no defined direction) lands
// exactly on the midpoint.
export const COLLISION_ANGLE_MIN_FACTOR = 0.85; // attacker moving away from/across the hit direction
export const COLLISION_ANGLE_MAX_FACTOR = 1.2; // attacker moving straight into the hit direction
