// ============================================================
// MOVEMENT — GAMEPLAY TUNING
// Kart-like steering/momentum (GDD section 15/172): direction change takes
// physical time, heading and velocity can diverge, grip progressively
// realigns them. Change these values to tune how the Bey drives.
// All values are Milestone 1 engineering placeholders, not final balance
// (GDD section 167) — they exist to make the prototype controllable and
// testable, not to lock a final "feel".
// ============================================================

// Forward/reverse thrust, in m/s^2 applied along the current heading.
export const ACCELERATION_MPS2 = 14;
export const REVERSE_ACCELERATION_MPS2 = 8;

// Steering: how fast heading CAN turn at full input (rad/s), and how
// quickly the actual turn rate eases toward that target (1/s — higher is
// snappier, lower feels heavier/more top-like). This is what makes
// direction change take physical time instead of snapping instantly.
export const STEERING_MAX_TURN_RATE_RAD_S = 2.6;
export const STEERING_RESPONSE_PER_S = 6;

// Soft speed cap: above this, extra drag grows with how far over the cap
// the Bey is, rather than a hard clamp (GDD section 18: "overspeed
// behavior" must stay stable, not an invisible wall).
export const INTENDED_MAX_SPEED_MPS = 11;
export const OVERSPEED_DRAG_PER_MPS_OVER = 2.2;

// Baseline rolling resistance along the heading direction, always active
// (fraction of longitudinal speed removed per second).
export const LONGITUDINAL_DRAG_PER_S = 0.6;

// Lateral grip: fraction of sideways (non-heading) velocity removed per
// second. High = tight, low-slip turning. Low = kart-style sliding. Drift
// temporarily substitutes a much lower value (see DriftTuning.ts).
export const LATERAL_GRIP_PER_S = 5.5;

// Airborne movement gets much less authority over velocity, per the
// approved "low air control" baseline (GDD section 12/20): mostly
// trajectory correction, not free steering.
export const AIRBORNE_LATERAL_GRIP_PER_S = 0.4;
export const AIRBORNE_ACCELERATION_FACTOR = 0.15; // fraction of normal thrust available while airborne

// After a significant collision, back off from forcibly re-steering
// velocity for this long, so the physics-resolved bounce is visible
// instead of being instantly overwritten by the grip model (GDD section
// 27/85: knockback should be felt, recovery should be gradual).
export const POST_IMPACT_GRIP_SUPPRESSION_S = 0.35;
// A velocity change larger than this during one physics step (beyond what
// our own model intended) counts as "a real impact" rather than ordinary
// per-tick correction.
export const IMPACT_VELOCITY_DELTA_THRESHOLD_MPS = 2.5;
