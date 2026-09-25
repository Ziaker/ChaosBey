// ============================================================
// SPIN / TILT / WOBBLE — GAMEPLAY TUNING
// A rapidly spinning Bey needs a rendering strategy separate from the
// rigid body's coarse orientation (GDD section 17/83): the physics body
// tracks TILT (a real, collision-driven lean, corrected by an upright
// recovery torque), while a decoupled "visual spin" value drives fast
// continuous rotation that never touches the physics body. WOBBLE is a
// third, purely-visual bounded oscillation layered on top, representing
// physical deterioration (GDD section 84).
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

// Upright recovery: a proportional-derivative controller pulling the
// Bey's up vector back toward world-up. Gain = how hard it corrects per
// radian of tilt; damping = how much it resists angular velocity (prevents
// endless oscillation/overshoot).
export const UPRIGHT_RECOVERY_TORQUE_GAIN = 9;
export const RECOVERY_DAMPING_PER_S = 2.4;

// Reference tilt angle used to normalize tilt-driven effects/debug display.
// Not a hard physics clamp — a real impact can and should exceed this
// temporarily (GDD section 16: impacts may throw the Bey off-axis).
export const MAX_GAMEPLAY_TILT_RAD = (35 * Math.PI) / 180;

// Impact response: converts a detected collision's velocity-delta
// magnitude (m/s, from MovementController) into an angular impulse that
// knocks the Bey off-axis (GDD section 87: knockback rotation).
// Kept deliberately gentle relative to the Bey's small moment of inertia:
// a value tuned "by feel" without checking this pushed even a strong
// (~8-10 m/s) impact well past 20 rad/s, which the floor collider turns
// into chaotic tumble-and-slam-the-ground behavior that the upright
// recovery torque can't cleanly resolve. This value keeps a strong impact
// in the "visibly knocked off-axis, recovers within about a second" range
// (see the self-test in tests/deterministic/wallImpactAndSpin.test.ts).
export const IMPACT_ANGULAR_IMPULSE_PER_MPS = 0.09;

// Wobble: bounded oscillation, visual-only (never fed back into physics —
// GDD section 84 warns against uncontrolled feedback loops). Energy is
// added on impact and decays exponentially.
export const WOBBLE_IMPACT_ENERGY_GAIN_PER_MPS = 0.12;
export const WOBBLE_ENERGY_MAX = 1;
export const WOBBLE_DECAY_FRACTION_PER_S = 1.2;
export const WOBBLE_AMPLITUDE_RAD = (6 * Math.PI) / 180;
export const WOBBLE_FREQUENCY_HZ = 7;
