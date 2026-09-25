// ============================================================
// DRIFT/JUMP — GAMEPLAY TUNING
// Kart-style hop-into-drift (GDD section 19): tap JumpDrift for a small
// hop, keep holding it while steering to slide with reduced lateral grip,
// release to gradually recover normal grip. No mini-turbo/boost — not yet
// approved (GDD section 19: "Do not automatically add Mario-Kart-style
// mini-turbo unless the user asks for/approves it").
//
// Milestone 3 layers a variable-height jump onto the same hop: holding
// JumpDrift *without* steering through the ascent adds extra lift
// (classic "hold to jump higher"), so a quick tap still gives exactly the
// old small hop while a held-without-steering press reaches higher.
// Steering signals drift intent instead and stops the height assist
// immediately, so entering a drift never accidentally becomes a tall jump.
//
// Landing is detected generically (any airborne->grounded transition, not
// just from a jump) and reported as data only — descent speed, a derived
// intensity metric, and how long jump-height assist applied — with no
// handling penalty of its own. Milestone 4's VFX/camera work consumes that
// data; it isn't produced here.
// ============================================================

// Vertical velocity added the instant JumpDrift is pressed while grounded
// — the same small, quick liftoff for both a bare tap and a held jump.
export const HOP_IMPULSE_MPS = 3.2;
// Minimum time to stay in the "hopping" state before a drift can begin,
// so the hop is visually readable even if the ground check re-triggers
// early.
export const HOP_MIN_AIRBORNE_DURATION_S = 0.12;

// Drift grip: much lower than normal ground grip (see MovementTuning's
// LATERAL_GRIP_PER_S), so the Bey slides instead of carving a tight turn.
export const DRIFT_LATERAL_GRIP_PER_S = 1.1;
// How long, after releasing JumpDrift, it takes lateral grip to ease back
// to normal — an instant snap back would feel like the slide never
// happened.
export const DRIFT_GRIP_RECOVERY_DURATION_S = 0.5;

// --- Variable jump height (Milestone 3) ---
// Extra upward acceleration applied every tick JumpDrift is still held
// while ascending, on top of the fixed liftoff impulse above.
export const JUMP_ASSIST_ACCEL_MPS2 = 16;
// Caps how long the assist can apply — holding forever must not give
// unbounded height.
export const JUMP_ASSIST_MAX_DURATION_S = 0.3;

// --- Landing data (Milestone 3 detects/reports; Milestone 4 consumes) ---
// Descent speed (m/s) that maps to a landing intensity of 1.0 (clamped
// above). An engineering placeholder per GDD section 167 — not a
// GDD-approved exact number, just enough range for a bare hop to read as
// weak and a big jump (or a hard knockback fall) to read as strong.
export const LANDING_INTENSITY_REFERENCE_DESCENT_SPEED_MPS = 10;
