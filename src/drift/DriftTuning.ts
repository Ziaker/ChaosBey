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
// Movement/weight/dodge playtest pass (owner feedback, section 7-9): the
// short hop read as "a flattened full jump" (low but travelling/hanging too
// long) because this one fixed impulse was the ENTIRE tap-release case —
// a bare tap got essentially this value and nothing else, and even alone,
// under this codebase's gravity, it produced a ~0.6s hang. Halved (3.2 ->
// 1.6) so a genuine tap (JumpDrift held only 1-2 ticks) is a real quick hop
// — still long enough to clear HOP_MIN_AIRBORNE_DURATION_S and start a
// drift, nowhere near a "compressed full jump". JUMP_ASSIST_ACCEL_MPS2
// below is raised to put the full held jump's height back where it was.
export const HOP_IMPULSE_MPS = 1.6;
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
// While drifting, time (s) the Bey may be off the ground — the landing
// bounce right after the hop, a bump — before the drift ends. Longer than
// the Motion Lab landing bounce (a hop landing at ~4 m/s leaves at
// 4 × floorBounce 0.35 = 1.4 m/s: ~0.29 s in the air; 0.25 cut the drift
// short in the browser), shorter than a real launch.
export const DRIFT_AIRBORNE_GRACE_S = 0.45;
// The hop's reference direction (what a turn is measured against) is the
// Bey's motion when X is pressed at this speed (m/s) or above; slower, it is
// the held direction, or the heading. A turn is the held direction more
// than MovementTuning's DIRECTIONAL_STEERING_THRESHOLD_RAD off it (the same
// threshold that counts as steering), or a turn key in classic control.
export const DRIFT_REFERENCE_MIN_SPEED_MPS = 2;

// --- Variable jump height (Milestone 3) ---
// Extra upward acceleration applied every tick JumpDrift is still held
// while ascending, on top of the fixed liftoff impulse above.
export const JUMP_ASSIST_ACCEL_MPS2 = 23;
// Caps how long the assist can apply — holding forever must not give
// unbounded height.
export const JUMP_ASSIST_MAX_DURATION_S = 0.3;

// --- Landing data (Milestone 3 detects/reports; Milestone 4 consumes) ---
// Descent speed (m/s) that maps to a landing intensity of 1.0 (clamped
// above). An engineering placeholder per GDD section 167 — not a
// GDD-approved exact number, just enough range for a bare hop to read as
// weak and a big jump (or a hard knockback fall) to read as strong.
export const LANDING_INTENSITY_REFERENCE_DESCENT_SPEED_MPS = 10;
