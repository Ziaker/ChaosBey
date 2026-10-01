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
// Movement/weight/dodge playtest pass (owner feedback, section 2): "reduced
// input-to-trajectory lag" — moderately quicker easing toward the target
// turn rate (was 6), so a held direction change registers sooner. The CAP
// above is untouched: this is still a top settling onto a new heading over
// a few ticks, not an instant snap (GDD section 15).
export const STEERING_RESPONSE_PER_S = 8;

// Top speed: thrust only adds up to it; above it (a bounce, a knockback,
// a slope) the excess bleeds away at this rate instead of being clamped
// (GDD section 18: overspeed must stay stable, not an invisible wall).
// Motion Lab model (prototypes/bey-motion-concepts/src/physics/model.ts).
export const INTENDED_MAX_SPEED_MPS = 11;
export const OVERSPEED_RETURN_PER_S = 1.5;

// Lateral grip: fraction of sideways (non-heading) velocity removed per
// second, at full grip. High = tight, low-slip turning. Low = kart-style
// sliding. Drift temporarily substitutes a much lower value (see
// DriftTuning.ts) through its own override, architecturally isolated from
// this one — raising it cannot touch drift. The motion direction
// (bey/motion/MotionPresets.ts) scales it and owns the rest of the grip
// model: rolling drag while coasting (longitudinalGrip), the slip
// threshold, grip while slipping, grip recovery and airborne grip.
//
// Movement/weight/dodge playtest pass (owner feedback, section 2/3/21): "a
// moderate increase in normal lateral grip" was tried here first (5.5 -> 7)
// but this coefficient is also the one the FULL-grip (not-slipping) case
// uses, and above ~6.3 it eats enough of bowl B's steepest-at-the-centre
// slope creep (a light 35% stick) to fall under the GDD's "light input
// can't leave bowl B's centre" regression floor (arenaFloor.test.ts) — a
// real, measured interaction with the slope-projection code. A sustained
// hard turn (the owner's own measurement scenario B) spends almost all its
// time in the SLIPPING state instead, governed by SLIP_GRIP_FLOOR_MULTIPLIER
// below, not this value — so this stays at the original 5.5 and the actual
// "less slip in a turn" improvement comes from that multiplier, which bowl
// B's light climb never reaches (it never crosses slipThreshold).
export const LATERAL_GRIP_PER_S = 5.5;

// Motion Lab slip model: once slipping, grip falls at this rate (per
// second) toward the direction's slipGrip; the tip re-grips only once the
// sideways speed is below this fraction of the slip threshold (hysteresis).
//
// SLIP_REGRIP_FRACTION: 0.6 -> 0.8 (movement/weight/dodge playtest pass,
// owner feedback section 2: "reduced excess side-slip after a direction
// change") — regrips once sideways speed drops below 0.8x the threshold
// instead of 0.6x, so full grip comes back sooner after a turn instead of
// lingering in the loose slipping state. Only changes the EXIT from an
// already-slipping turn (large lateral speed, well above bowl B's light-
// stick slope creep that never enters this state at all — see
// LATERAL_GRIP_PER_S's own comment on that regression floor), so this is
// safe to move further than the base grip coefficient was.
export const SLIP_GRIP_LOSS_PER_S = 4;
export const SLIP_REGRIP_FRACTION = 0.8;

// Multiplies the motion direction's own slipGrip (a Lab-locked value — see
// MotionPresets.ts's header — never edited directly here) when computing
// how low the grip multiplier is allowed to fall once actually slipping.
// Movement/weight/dodge playtest pass (owner feedback, section 2/3): the
// main source of "excess slip in a sustained turn" (measurement scenario B:
// 12 m/s into a 90° turn) is this floor, not the full/not-slipping grip
// coefficient above — a hard turn spends nearly all of it in the slipping
// state. Raising this moderately tightens turns measurably (slip angle
// -40%+ in scenario B) without touching LATERAL_GRIP_PER_S, so bowl B's
// light-stick creep (which never crosses slipThreshold, never slips, never
// reads this multiplier) is unaffected, and drift's own fully separate
// 1.1/s override stays untouched regardless.
export const SLIP_GRIP_FLOOR_MULTIPLIER = 1.3;

// Multiplies the motion direction's own gripRecovery (a Lab-locked value —
// see MotionPresets.ts's header — never edited directly here). Movement/
// weight/dodge playtest pass (owner feedback, section 2), same reasoning as
// SLIP_REGRIP_FRACTION above: once broken loose, the grip multiplier climbs
// back toward 1 faster, cutting how long a turn spends at the slip floor
// without changing the floor itself (slipGrip) or any direction's own
// recovery personality (A recovers faster than B, C slower — this scales
// all three by the same ratio). Also only affects the slipping exit, not
// bowl B's light-stick case.
export const GRIP_RECOVERY_MULTIPLIER = 1.8;

// Airborne movement gets much less thrust, per the approved "low air
// control" baseline (GDD section 12/20): mostly trajectory correction,
// not free steering. (Airborne lateral grip is the direction's airGrip.)
//
// Jump/air-control hotfix (owner decision, section 14): "at least +20%
// more trajectory-correction capability" during a normal jump, measured —
// not a blind ×1.20 of this constant — by the actual angular correction a
// fixed ~267 ms (16-tick) perpendicular input produces after liftoff, at
// 0/5/10/15 m/s initial horizontal speed, against the pre-hotfix baseline
// (0.15). Doubling it to 0.30 measured +22.0%/+20.6%/+16.6% at 5/10/15 m/s
// respectively (smaller at higher speed, as section 19 allows: momentum
// dominates more there) and +96.4% on lateral displacement at 0 m/s, where
// the angle metric itself is unstable (a near-stationary Bey's velocity
// direction is barely defined, so section 15's "use both, state which is
// primary" applies — lateral displacement is the one that means something
// at 0 m/s). A full-perpendicular-input sanity check through an entire
// full jump still only redirects ~17°, nowhere near the 90° instant-strafe
// section 16 forbids: heading can already turn freely in the air (this
// constant only throttles how fast thrust rebuilds speed along it), so the
// low-air-control character comes from how slowly velocity follows, not
// from capping the turn itself.
export const AIRBORNE_ACCELERATION_FACTOR = 0.3; // fraction of normal thrust available while airborne

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
export const DIRECTIONAL_STEER_GAIN_PER_S = 12;
// Owner playtest (after M11): "it keeps going in wrong directions instead
// of the direction I'm moving". With classic-car turning (2.6 rad/s,
// gain 3/s, easing 6/s) a Bey at rest took 0.5 s to move 6 cm toward a
// direction 90° away and stalled for a whole second on one behind it. A
// top has no front wheels: in directional mode its heading swings toward
// the wanted direction this many times faster than the classic turn
// rate, with a quicker easing — still a limit and still eased, so a new
// direction takes a moment and momentum/slip/drift still play out.
export const DIRECTIONAL_TURN_RATE_MULTIPLIER = 3;
export const DIRECTIONAL_STEERING_RESPONSE_PER_S = 20;
// Thrust along the heading is scaled by cos(error)^this: close to full
// once facing the direction, little while still turning, so the Bey is
// not driven off at an angle (at 45° off: 0.5 instead of 0.71).
export const DIRECTIONAL_THRUST_ALIGNMENT_POWER = 2;
// Heading error (rad) beyond which a held direction counts as "steering"
// for drift (hop, then hold JumpDrift while steering).
export const DIRECTIONAL_STEERING_THRESHOLD_RAD = 0.25;

// Owner playtest (after M11): "it moves by itself". Released at top speed
// (~11 m/s) a Bey coasted 6.6 m over 1.35 s on rolling drag and floor
// friction alone. With no movement input, on the ground and outside an
// impact's window, its speed also decays at this rate (1/s). It is
// proportional, not a constant brake: strong at speed, weak when slow, so
// an idle Bey pushed by another still gives way instead of acting like a
// wall; knockbacks and bounces are not damped.
export const IDLE_DAMPING_PER_S = 4;

// A landing keeps its horizontal speed (the Motion Lab's landing model)
// only when the landing step slowed it along the same line: cos of the
// largest direction change still counted as "the same line" (~8°).
export const LANDING_SAME_LINE_COS = 0.99;
