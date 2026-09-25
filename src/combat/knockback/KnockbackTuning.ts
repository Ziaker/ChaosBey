// ============================================================
// KNOCKBACK — GAMEPLAY TUNING
// Formula components approved by GDD section 27: attack force, attacker
// velocity, defender velocity ("a slower defender is more vulnerable to
// knockback" — explicitly approved rule), defender Defense/Stability/
// Stamina state, collision angle, mass. Attack/Defense *stats* don't
// exist yet (three-archetype balance is Milestone 6) — this formula is
// structured so a real stat multiplier drops in later without a redesign
// (GDD section 166), using a neutral placeholder multiplier meanwhile.
// All coefficients are Milestone 2 engineering placeholders (GDD section
// 167), bounded to avoid singularities (GDD section 126).
// ============================================================

export const ATTACK_STAT_MULTIPLIER_PLACEHOLDER = 1; // GDD section 6/31 archetype Attack stat integrates here once it exists (Milestone 6).
export const DEFENSE_STAT_MULTIPLIER_PLACEHOLDER = 1; // ditto for defender Defense.

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

export const STABILITY_DAMAGE_DEFENSE_REDUCTION_AT_FULL = 0.3; // Defense also reduces Stability damage taken (GDD section 31 Defense responsibilities).
