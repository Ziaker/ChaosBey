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
/**
 * Central default for the Clash impact multiplier — NOT the value
 * orchestration actually uses. GDD section 152 requires this multiplier
 * to be configurable pre-match, so the single resolved value lives in
 * MatchConfig (src/config/match/MatchConfig.ts), which starts from this
 * default and applies any pre-match override; ClashOrchestration only
 * ever reads that resolved value, never this constant directly, so there
 * is exactly one source of truth at runtime.
 */
export const CLASH_IMPACT_MULTIPLIER_DEFAULT = 1;

// --- AI mash (Milestone 7 placeholder — see ClashMash.ts's FixedIntervalAiMashSource) ---
/** How often (in fixed ticks) the placeholder AI contributes a mash event during an Active Clash — NOT real AI behavior, just enough for the integration/self-tests to exercise the AI-mash pathway before Milestone 7 exists. ~10 events/second at 60Hz. */
export const CLASH_AI_MASH_INTERVAL_TICKS = 6;

// --- Cooldown "alternative resolution" (GDD: during Cooldown, a compatible
// double-hit does not start a new Clash — both hits still resolve with
// their own normal knockback/Stability damage, but the slower combatant
// (by current speed) takes proportionally more, as a deterrent against
// spamming collisions while a Clash is on cooldown). Engineering
// placeholder (GDD section 167) — the GDD specifies the "slower suffers
// more" direction, not an exact number. ---
/** Extra multiplier (added on top of 1.0) applied to the slower combatant's incoming knockback/Stability damage when the speed gap between the two combatants is at or above CLASH_VELOCITY_REFERENCE_MPS; scales down to 0 extra when they're equal or the "slower" one is actually not slower at all. */
export const CLASH_COOLDOWN_ALT_SLOWER_PENALTY_MAX = 0.5;

// --- Tie resolution (owner decision: both Beys receive symmetric physical
// repulsion, no winner, no Stability damage — normal physics decides the
// rest, a ring-out is never declared by the Clash system itself). ---
/** Base "force" (same units as a hitbox's knockbackForce — see combat/knockback/Knockback.ts) used for the symmetric repulsion impulse applied to both Beys on a Tie. Engineering placeholder (GDD section 167); scaled by MatchConfig's resolved clashImpactMultiplier like every other Clash-driven knockback. */
export const CLASH_TIE_REPULSION_BASE_FORCE = 10;

// --- Presentation cadence (main.ts) ---
/** How often (in fixed ticks) a small progressive spark burst spawns at the clash point while Active, so visual intensity is felt building over the ~4s contest rather than only flashing once at the very end. */
export const CLASH_PROGRESSIVE_VFX_INTERVAL_TICKS = 10;
