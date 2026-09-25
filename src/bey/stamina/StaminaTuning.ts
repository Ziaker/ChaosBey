// ============================================================
// STAMINA — GAMEPLAY TUNING
// Long-term spin/endurance capacity (GDD section 30/31). Low Stamina must
// degrade *physically* (reduced accel, faster spin decay, more wobble,
// weaker recovery torque, higher knockback vulnerability) — never make
// directional input feel randomly unresponsive (GDD section 30 explicit
// warning). All values are Milestone 2 engineering placeholders.
// ============================================================

export const STAMINA_MAX = 100;

// Owner decision (2026-09-25): Stamina never passively regenerates during
// a round — it is the long-term wear-down resource (Attack Energy is the
// fast-recovering offensive one; see AttackEnergyTuning.ts). A Bey always
// loses a little Stamina just from continuous spin/combat, on top of
// extra drain from aggressive movement — structured so additional costs
// (e.g. per-impact) can be added later without a redesign.
export const STAMINA_BASE_DRAIN_PER_S = 0.4;

// Extra drain tied to aggressive movement (GDD section 12): draining
// faster while moving fast, on top of the baseline above.
export const STAMINA_DRAIN_SPEED_THRESHOLD_FRACTION = 0.5; // fraction of INTENDED_MAX_SPEED_MPS above which the extra drain kicks in
export const STAMINA_EXTRA_DRAIN_PER_S_AT_FULL_SPEED = 3;

// Degradation curve: below this fraction, physical penalties start
// ramping in linearly down to zero stamina. Above it, no penalty at all —
// low stamina should read as a late-fight state, not a constant tax.
export const STAMINA_PENALTY_START_FRACTION = 0.4;

// At zero stamina, these are the floors the physical-condition multiplier
// can reach (1 = no penalty, applied at/above STAMINA_PENALTY_START_FRACTION).
export const STAMINA_MIN_ACCEL_FACTOR = 0.6;
export const STAMINA_MIN_RECOVERY_TORQUE_FACTOR = 0.5;
export const STAMINA_MAX_SPIN_DECAY_MULTIPLIER = 3; // spin decays up to 3x faster at zero stamina.
export const STAMINA_MAX_WOBBLE_ENERGY_FLOOR = 0.25; // ambient wobble energy floor blended in at zero stamina — a tired Bey never looks perfectly steady.
