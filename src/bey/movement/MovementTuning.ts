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

// Top speed: thrust only adds up to it; above it (a bounce, a knockback,
// a slope) the excess bleeds away at this rate instead of being clamped
// (GDD section 18: overspeed must stay stable, not an invisible wall).
// Motion Lab model (prototypes/bey-motion-concepts/src/physics/model.ts).
export const INTENDED_MAX_SPEED_MPS = 11;
export const OVERSPEED_RETURN_PER_S = 1.5;

// Lateral grip: fraction of sideways (non-heading) velocity removed per
// second, at full grip. High = tight, low-slip turning. Low = kart-style
// sliding. Drift temporarily substitutes a much lower value (see
// DriftTuning.ts). The motion direction (bey/motion/MotionPresets.ts)
// scales it and owns the rest of the grip model: rolling drag while
// coasting (longitudinalGrip), the slip threshold, grip while slipping,
// grip recovery and airborne grip.
export const LATERAL_GRIP_PER_S = 5.5;

// Motion Lab slip model: once slipping, grip falls at this rate (per
// second) toward the direction's slipGrip; the tip re-grips only once the
// sideways speed is below this fraction of the slip threshold (hysteresis).
export const SLIP_GRIP_LOSS_PER_S = 4;
export const SLIP_REGRIP_FRACTION = 0.6;

// Airborne movement gets much less thrust, per the approved "low air
// control" baseline (GDD section 12/20): mostly trajectory correction,
// not free steering. (Airborne lateral grip is the direction's airGrip.)
export const AIRBORNE_ACCELERATION_FACTOR = 0.15; // fraction of normal thrust available while airborne

// Motion Lab landing bounce: a landing bounces up at descent × the
// direction's floorBounce, unless that is below this (then it just lands).
export const LANDING_BOUNCE_MIN_MPS = 0.6;
// ...and only after this many airborne ticks (0.1 s): a real fall, not a
// contact lost for a tick.
export const LANDING_BOUNCE_MIN_AIRBORNE_TICKS = 6;

// Share of an impact's glancing speed (the incoming velocity across the
// push direction) that reaches the Motion Lab's linear-to-angular
// transfer: the Lab uses 0.3 of it for a wall and 0.5 for a Bey; the
// game's impact detector cannot tell them apart, so it takes the middle.
export const IMPACT_TANGENTIAL_TRANSFER = 0.4;

// After a significant collision, back off from forcibly re-steering
// velocity for this long, so the physics-resolved bounce is visible
// instead of being instantly overwritten by the grip model (GDD section
// 27/85: knockback should be felt, recovery should be gradual).
export const POST_IMPACT_GRIP_SUPPRESSION_S = 0.35;
// A velocity change larger than this during one physics step (beyond what
// our own model intended) counts as "a real impact" rather than ordinary
// per-tick correction.
export const IMPACT_VELOCITY_DELTA_THRESHOLD_MPS = 2.5;

// Directional control (M11): the player's stick/arrows give a desired
// world direction and the heading turns toward it through the same
// turn-rate limit and easing as the classic steering. The target turn
// rate is proportional to the heading error (rad/s per rad), capped at
// the Bey's turn rate, so the heading settles on the direction instead of
// overshooting it.
export const DIRECTIONAL_STEER_GAIN_PER_S = 3;
// Heading error (rad) beyond which a held direction counts as "steering"
// for drift (hop, then hold JumpDrift while steering).
export const DIRECTIONAL_STEERING_THRESHOLD_RAD = 0.25;
