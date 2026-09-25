// ============================================================
// CLASH — GAMEPLAY TUNING
// Milestone 5 core (GDD): two attacks connecting within a 150ms window
// trigger a Clash — a ~4s mash contest resolved by
// ClashPower = MashPerformance × StaminaFactor × VelocityFactor, then a
// 10s cooldown before another Clash can start. All numeric values below
// are Milestone 5 engineering placeholders (GDD section 167) — the
// mechanics/formula shape are approved, the exact balance is not.
//
// This package is deliberately self-contained (no imports from outside
// src/combat/clash/) so it can be developed in isolation from Milestone
// 4's in-flight camera/VFX/input work — see the module-level note in
// ClashController.ts for what is and isn't implemented yet.
// ============================================================

// --- Trigger window ---
/** GDD-approved: two attacks connecting within this many seconds of each other are eligible to Clash. */
export const CLASH_WINDOW_S = 0.15;

// --- Duration / cooldown ---
/** Target Clash presentation duration (GDD: ~4s mash contest). */
export const CLASH_TARGET_DURATION_S = 4;
/** GDD-approved: cooldown after a Clash resolves before another can start. */
export const CLASH_COOLDOWN_S = 10;

// --- Mash Performance ---
/** Mash event count (see ClashMash.ts — simultaneous presses in one tick count as a single event) that reaches MashPerformance = 1.0 over the full Clash duration. */
export const CLASH_MASH_REFERENCE_EVENT_COUNT = 20;

// --- Stamina Factor (capped, never zeroes a combatant out of the Clash entirely) ---
export const CLASH_STAMINA_FACTOR_MIN = 0.5;
export const CLASH_STAMINA_FACTOR_MAX = 1.0;

// --- Velocity Factor (capped) ---
// Duplicated locally rather than importing bey/movement/MovementTuning's
// INTENDED_MAX_SPEED_MPS, to keep this package's dependency graph fully
// self-contained during parallel Milestone 4/5 development; reconcile the
// two at integration time if they should be the same source of truth.
export const CLASH_VELOCITY_REFERENCE_MPS = 11;
export const CLASH_VELOCITY_FACTOR_MIN = 0.6;
export const CLASH_VELOCITY_FACTOR_MAX = 1.0;

// --- Resolution ---
/** Floating-point tolerance for treating two ClashPower values as an exact Tie — not a designed "near-tie" mechanic, just float-safety around equal inputs. */
export const CLASH_TIE_EPSILON = 1e-6;

// --- Downstream integration (data only — not applied by this package) ---
/** Configurable multiplier the eventual knockback/stability resolution (Milestone 5 integration, not yet implemented here) applies to the Clash's outcome. Present now so tuning has a home; unused until that integration lands. */
export const CLASH_IMPACT_MULTIPLIER = 1;
