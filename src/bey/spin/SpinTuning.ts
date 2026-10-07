// ============================================================
// SPIN / TILT / WOBBLE — GAMEPLAY TUNING
// A rapidly spinning Bey needs a rendering strategy separate from the
// rigid body (GDD section 17/83): the ATTITUDE (tilt) is the Motion Lab's
// model (M11, see SpinController — the physics body no longer tilts), a
// decoupled "visual spin" value drives fast continuous rotation that
// never touches the physics body, and WOBBLE is a bounded oscillation
// layered on top, representing physical deterioration (GDD section 84).
// ============================================================

// Continuous visual spin rate, rad/s, about the Bey's own up axis. Not a
// literal RPM simulation — picked for clear visual "this is spinning fast"
// readability. Milestone 1 placeholder; stamina-linked degradation is
// Milestone 2+ (GDD section 123).
export const BASE_SPIN_RATE_RAD_S = 22;
// Fractional decay per second — deliberately gentle for now since there is
// no re-spin/launch mechanic yet to counteract it (GDD section 13 is
// deferred); exists so decay is tested and tunable, not to visibly run
// the Bey down mid-session.
export const SPIN_DECAY_FRACTION_PER_S = 0.01;

// Reference tilt angle for normalizing tilt-driven effects and debug
// display (motion direction B's maxTilt). The attitude's own soft stop is
// each direction's maxTilt (bey/motion/MotionPresets.ts); a tumble may go
// past it, up to ATTITUDE_TILT_CLAMP_RAD.
export const MAX_GAMEPLAY_TILT_RAD = (35 * Math.PI) / 180;

// The Motion Lab's hard clamp on the attitude during a tumble (numerical
// safety, GDD 82).
export const ATTITUDE_TILT_CLAMP_RAD = (80 * Math.PI) / 180;

// Wobble: bounded oscillation, visual-only (never fed back into physics —
// GDD section 84 warns against uncontrolled feedback loops). Energy is
// added on impact and decays exponentially. Amplitude, frequency, gain per
// impact and decay come from the motion direction (bey/motion/
// MotionPresets.ts; B = the game's former 6°, 7 Hz, 0.12, 1.2).
export const WOBBLE_ENERGY_MAX = 1;

// Owner, 2026-10-02 (Lote 6, item 10): above this Stamina AND Stability
// fraction the Bey is steady — no ambient wobble and no precession (the
// axis does not circle). Below it, both ramp in smoothly to full at 0
// (whichever resource is lower drives it). Impacts still add a momentary
// wobble that decays, at any condition.
export const AXIS_UNREST_START_FRACTION = 0.7;
// Ambient wobble energy at the bottom of that ramp (the former Stamina
// floor's value — it used to start at 40% Stamina only).
export const AMBIENT_WOBBLE_ENERGY_FLOOR_MAX = 0.25;

/** 0 at/above AXIS_UNREST_START_FRACTION, rising linearly to 1 at 0 (the lower of Stamina and Stability fractions). */
export function axisUnrest(conditionFraction: number): number {
  return Math.min(1, Math.max(0, (AXIS_UNREST_START_FRACTION - conditionFraction) / AXIS_UNREST_START_FRACTION));
}

// Motion Lab tilt model (prototypes/bey-motion-concepts/src/physics/model.ts):
// a hit above the direction's tumble threshold tumbles the Bey for
// BASE + PER_MPS × excess seconds, with the upright spring at this
// fraction; past the direction's maxTilt (not tumbling) a stop this many
// times the spring pushes back; the lean follows acceleration smoothed at
// this rate.
export const TUMBLE_BASE_DURATION_S = 0.4;
export const TUMBLE_DURATION_PER_MPS = 0.08;
export const TUMBLE_RECOVERY_FACTOR = 0.35;
export const TILT_OVERSHOOT_STOP_GAIN = 3;
export const LEAN_ACCEL_SMOOTHING_PER_S = 12;

// Air recovery (Milestone 3): a player-triggered stabilization while
// airborne (via Dodge — see DodgeController), distinct from the always-on
// upright spring. Instantly cuts wobble, ends a tumble and swings the
// attitude back toward upright (its rate set to −tilt × this, per second),
// so a Bey that got knocked off-axis visibly recovers faster than passive
// correction alone before landing.
export const AIR_RECOVERY_WOBBLE_REDUCTION = 0.6;
export const AIR_RECOVERY_ATTITUDE_RETURN_PER_S = 8;

// Drift body language (owner playtest, after M11): while Drifting, the
// attitude leans this far (deg) into the turn, against the sideways slide,
// reached once the tip slides sideways at DRIFT_LEAN_FULL_SLIDE_MPS.
// Render only (the attitude never reaches gameplay or the state hash).
export const DRIFT_LEAN_DEG = 16;
export const DRIFT_LEAN_FULL_SLIDE_MPS = 4;
