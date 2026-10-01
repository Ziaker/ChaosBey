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
// Jump/air-control hotfix FOLLOW-UP (owner review): the first version of
// this release cut targeted a fixed VELOCITY floor (JUMP_SHORT_RELEASE_FLOOR_MPS,
// since removed), which only gave a genuinely consistent short hop for a
// true single-tick tap — by 2 ticks the apex was already ~45% taller. The
// owner correctly rejected a mandatory test that just widened its
// tolerance to paper over that instead of fixing it. The fix: target a
// fixed APEX HEIGHT instead (same technique DRIFT_HOP_TARGET_APEX_M/
// computeDriftHopCutMps already used), so a release stays pinned to the
// SAME apex for as long as the arc's own natural (uncut) height hasn't yet
// reached that target — computeJumpReleaseCapMps's own comment proves this
// window exactly, and why it cannot be widened further without either
// shrinking the full-jump target below its approved 1.0-1.5 m floor or
// accepting a much longer hold-to-reach-full-jump time: height under a
// fixed launch velocity grows as V0*t for small t, independent of
// whatever happens to vy afterward (cut or not), so the width of the
// "exactly reproducible" window is set by V0 and this target alone, not by
// the cut formula's shape. With V0 = 5 and this target, that window is
// ~2.5-3 ticks (42-50 ms) — not the full 1-5 ticks initially hoped for,
// but a real, measured improvement (previously 1 tick), and, past that
// window, growth is now a smooth ramp toward the natural full arc instead
// of linear-in-velocity-from-tick-1. 0.2036 m = the movement/weight/dodge
// pass's own measured baseline apex (0.177 m) x1.15.
export const JUMP_SHORT_HOP_TARGET_APEX_M = 0.1265;
// How long, from the press, a release still shapes the jump's height at
// all: release before this and computeJumpReleaseCapMps's ramp (fixed
// target, then smoothly toward the natural arc) applies; hold at least
// this long and the jump is already committed to its full, uncut
// JUMP_LAUNCH_VELOCITY_MPS arc (saturation — holding further changes
// nothing, since there is nothing left to cut).
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
// minimizing the overshoot once it can't (the same width limit
// JUMP_SHORT_HOP_TARGET_APEX_M's own comment proves for the short hop —
// this is the same formula, same V0, same physical ceiling). Unlike the
// regular jump release, a later-arming drift is never allowed to ramp up
// toward the full arc — GDD section 21/22 wants the SAME small drift-hop
// profile no matter when within the press the turn happens, so this
// always cuts toward this one fixed target, even once that can only
// minimize the overshoot rather than hit it exactly. 0.127, not
// JUMP_SHORT_HOP_TARGET_APEX_M's own 0.2036, because this target is hit
// via a different code path with a different measured discrete-tick
// offset — both are tuned so an instant turn and an instant release reach
// the same ~0.2 m apex in practice (see the hold-duration sweep).
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

// Jump input buffer (hotfix: a JumpDrift press arriving in Idle/Recovering
// while grounded is transiently false — a bounce, a Clash knockback
// settling, the ground check re-triggering a tick or two late right before
// a real landing — used to be silently and permanently dropped; confirmed
// happening in real AI matches via direct input-event/landing instrumentation,
// not inferred from height data. This is NOT coyote time: coyote time would
// let a hop start with no press at all near a ledge; this only keeps an
// ALREADY-HAPPENED real press alive a little longer so the landing a few
// ticks later can still consume it, exactly once (DriftController.beginHop
// clears it the instant it's consumed). 0.1 s = 6 ticks at
// FIXED_TICKS_PER_SECOND (60): several times wider than the 1-3 tick
// grounded-signal noise actually observed before a real landing, but far
// shorter than HOP_MIN_AIRBORNE_DURATION_S (0.12 s) or any real hop's own
// airborne arc — short enough that a buffered press can never plausibly
// reach a LATER, unrelated landing instead of the bounce it was meant for,
// so it can't be mistaken for a second, phantom input and can't produce a
// double hop.
export const JUMP_INPUT_BUFFER_WINDOW_S = 0.1;

// --- Landing data (Milestone 3 detects/reports; Milestone 4 consumes) ---
// Descent speed (m/s) that maps to a landing intensity of 1.0 (clamped
// above). An engineering placeholder per GDD section 167 — not a
// GDD-approved exact number, just enough range for a bare hop to read as
// weak and a big jump (or a hard knockback fall) to read as strong.
export const LANDING_INTENSITY_REFERENCE_DESCENT_SPEED_MPS = 10;
