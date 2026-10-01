// ============================================================
// DRIFT/JUMP — GAMEPLAY TUNING
// Kart-style hop-into-drift (GDD section 19): tap JumpDrift for a small
// hop, keep holding it while steering to slide with reduced lateral grip,
// release to gradually recover normal grip. No mini-turbo/boost — not yet
// approved (GDD section 19: "Do not automatically add Mario-Kart-style
// mini-turbo unless the user asks for/approves it").
//
// Jump/weight/air-control hotfix (owner feedback): the variable-height jump
// used to be "small fixed liftoff + a continuous upward acceleration every
// tick JumpDrift stayed held, up to a cap". That accel (23 m/s^2) exceeded
// gravity's magnitude (10.5), so the NET vertical acceleration while held
// was positive — vy kept rising after liftoff instead of only decaying —
// which read as a second impulsion mid-air ("double jump"), not one
// continuous arc. See DriftController.ts for the audit that found this.
//
// The model is now "single initial launch velocity + at most one release
// cut": JUMP_LAUNCH_VELOCITY_MPS is applied once, in full, the instant
// JumpDrift is pressed (immediate liftoff, GDD section 13 of that
// feedback — no waiting to see how long the press lasts). From there, vy
// only ever decreases (gravity, automatic, every tick, same as a free
// fall) — there is no per-tick addition at all. The HEIGHT the jump
// actually reaches is shaped by at most one, one-time reduction applied
// the instant JumpDrift is released (or a drift arms, or the hold window
// below elapses) while still rising: computeJumpReleaseCapMps in
// DriftController.ts picks a velocity that is always <= the natural,
// uncut decay curve at that moment (provably, see its own comment), so
// this can only ever cut the arc short, never add to it — satisfying
// "vy(t+1) <= vy(t) + tolerance" and "exactly one apex" by construction,
// not by a separate check bolted on after the fact.
export const JUMP_LAUNCH_VELOCITY_MPS = 5;
// The release-cut floor: releasing (or arming a drift) the instant
// JumpDrift is pressed clamps vy down to roughly this much added lift —
// this is what actually produces the short hop's apex (picked, with
// JUMP_LAUNCH_VELOCITY_MPS/JUMP_RELEASE_WINDOW_S below, to land the short
// hop at +15% over the movement/weight/dodge pass's own measured baseline
// apex of 0.177 m — see the hold-duration sweep in
// physicsWeightFeelPass.test.ts for the measured result).
export const JUMP_SHORT_RELEASE_FLOOR_MPS = 1.62;
// How long, from the press, a release still shapes the jump's height at
// all: release (or drift-arm) before this and the cut floor above still
// applies in full; hold at least this long and the jump is already
// committed to its full, uncut JUMP_LAUNCH_VELOCITY_MPS arc (saturation —
// holding further changes nothing, since there is nothing left to cut).
// In between, the cut floor rises smoothly (linearly in hold time) from
// the short-hop floor to the arc's own natural velocity at this exact
// moment, so the hold-duration-to-height curve has no step.
export const JUMP_RELEASE_WINDOW_S = 0.22;
// Drift's own hop profile (GDD section 19/20): arming a drift mid-press
// cuts the rise down to this APEX HEIGHT target instead of the
// release-window curve above — a height target, not a fixed velocity,
// because a turn can arm the drift at any point in the press, and the
// height already gained while rising at the full, uncut launch velocity
// before the cut can apply is structurally un-cuttable by any
// velocity-only correction (DriftController.computeDriftHopCutMps solves
// "height already gained, plus the remaining rise from the cut velocity,
// equals this target" for the cut velocity, which gets as close to a
// timing-independent drift hop as a one-time, no-position-snap correction
// can — see the hold-duration sweep for exactly how early the turn needs
// to be for that solve to still hit this target exactly, versus only
// minimizing the overshoot once it can't). 0.204 m matches the short
// hop's own +15%-over-baseline apex target (DRIFT_HOP_TARGET_APEX_M and
// JUMP_SHORT_RELEASE_FLOOR_MPS are tuned to produce the same apex at
// holdElapsedS=0 — an instant turn and an instant release should feel the
// same small hop).
export const DRIFT_HOP_TARGET_APEX_M = 0.127;
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

// --- Landing data (Milestone 3 detects/reports; Milestone 4 consumes) ---
// Descent speed (m/s) that maps to a landing intensity of 1.0 (clamped
// above). An engineering placeholder per GDD section 167 — not a
// GDD-approved exact number, just enough range for a bare hop to read as
// weak and a big jump (or a hard knockback fall) to read as strong.
export const LANDING_INTENSITY_REFERENCE_DESCENT_SPEED_MPS = 10;
