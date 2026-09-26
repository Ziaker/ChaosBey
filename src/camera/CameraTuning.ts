// ============================================================
// COMBAT CAMERA — GAMEPLAY/FEEL TUNING
// Milestone 4 (GDD section 50+): combat camera, speed FOV, shake, hitstop,
// knockback follow. Visual DIRECTION is owner-approved as profile "C —
// Hybrid scalable" (2026-09-25): normally clean/legible, escalating toward
// a more cinematic ("anime") response only as impact magnitude grows —
// small, routine contact must stay subtle; a KO, ring-out, Stability
// Break or Perfect Dodge should always read as a genuine moment. See
// ImpactMagnitude.ts for how a raw gameplay number becomes that 0..1
// magnitude. All numeric values below are Milestone 4 engineering
// placeholders per GDD section 167 — the *shape* of the response (scaling
// with magnitude, capped so nothing ever locks up or blinds the player)
// is the approved part, not these exact numbers.
// ============================================================

// --- Base framing ---
// GDD-approved camera identity: opponent-focused, semi-over-the-shoulder
// (not a fixed-world-axis "elevated tripod") — the camera sits behind the
// player, offset to one shoulder, oriented along the live player->opponent
// axis rather than always along world +Z. CAMERA_ORBIT_SMOOTHING_PER_S
// controls how quickly that orientation "orbits" to follow the fight as
// the two Beys move around the arena — a slow, deliberate blend, not a
// snap, per the GDD's "automatic orbit/contextual placement" note.
export const CAMERA_BASE_DISTANCE_M = 9;
export const CAMERA_BASE_HEIGHT_M = 6;
// Extra distance added per meter the two Beys are separated beyond this —
// keeps both in frame when they're far apart instead of clipping one out.
export const CAMERA_SEPARATION_REFERENCE_M = 3;
export const CAMERA_SEPARATION_TO_DISTANCE_FACTOR = 0.6;
export const CAMERA_MIN_DISTANCE_M = 7;
export const CAMERA_MAX_DISTANCE_M = 16;
// Exponential smoothing rate for the camera's eye/focus position chasing
// its desired value — higher is snappier. Applied as
// `1 - exp(-RATE * dt)` so it's frame-rate independent.
export const CAMERA_POSITION_SMOOTHING_PER_S = 6;
// How far, in radians, the camera sits off dead-center-behind-the-player —
// the "semi" in semi-over-the-shoulder (a positive offset consistently
// biased to one side, not perfectly centered on the fight axis).
export const CAMERA_SHOULDER_OFFSET_RAD = 0.35; // ~20 degrees.
// Angular smoothing rate for the camera's orbit around the fight axis —
// deliberately slower than position smoothing so re-orienting as the
// fighters turn around the arena reads as an orbit, never a snap.
export const CAMERA_ORBIT_SMOOTHING_PER_S = 3;

// --- Speed FOV (GDD: FOV widens with speed for a sense of velocity) ---
export const CAMERA_FOV_BASE_DEG = 55;
export const CAMERA_FOV_MAX_SPEED_BONUS_DEG = 12;
// Combined (both Beys summed) speed that maps to the full speed-FOV bonus.
export const CAMERA_FOV_SPEED_REFERENCE_MPS = 22;
export const CAMERA_FOV_SMOOTHING_PER_S = 4;

// --- Impact FOV punch (a brief extra widen on a strong hit/KO/ring-out) ---
export const CAMERA_FOV_PUNCH_MAX_DEG = 10;
export const CAMERA_FOV_PUNCH_DECAY_PER_S = 6;

// --- Camera shake ---
// Below this impact magnitude, no shake at all — routine hits must stay
// clean and readable (profile C).
export const CAMERA_SHAKE_MIN_MAGNITUDE = 0.12;
export const CAMERA_SHAKE_AMPLITUDE_REFERENCE_M = 0.35;
export const CAMERA_SHAKE_DECAY_PER_S = 8;
export const CAMERA_SHAKE_FREQUENCY_HZ = 18;

// --- Hitstop (brief simulation freeze on a strong impact) ---
// Below this impact magnitude, no hitstop at all.
export const CAMERA_HITSTOP_MIN_MAGNITUDE = 0.35;
export const CAMERA_HITSTOP_DURATION_PER_MAGNITUDE_S = 0.18;
export const CAMERA_HITSTOP_MAX_DURATION_S = 0.18;

// --- High-speed camera (GDD: distinct from speed FOV above — a further,
// conservative reframing that only kicks in at genuinely extreme
// individual speed, e.g. a Dash Attack, not just "both Beys moving
// briskly". Profile C: negligible at normal speed, a modest pullback/
// wider-angle/higher-angle blend at the top end.) ---
export const CAMERA_HIGH_SPEED_THRESHOLD_MPS = 14; // above ordinary top speed (11 mps) — a Dash Attack (up to 18 mps) is the intended trigger.
export const CAMERA_HIGH_SPEED_FULL_BLEND_MPS = 18;
export const CAMERA_HIGH_SPEED_EXTRA_DISTANCE_M = 2;
export const CAMERA_HIGH_SPEED_EXTRA_HEIGHT_M = 0.6;
export const CAMERA_HIGH_SPEED_EXTRA_FOV_DEG = 4;
export const CAMERA_HIGH_SPEED_BLEND_SMOOTHING_PER_S = 5;

// --- Knockback follow (camera focus leans toward a Bey that just got
// launched, so it doesn't leave frame, per GDD's explicit M3 "air recovery
// after knockback" + M4 "knockback follow" pairing) ---
export const CAMERA_KNOCKBACK_FOLLOW_BIAS_MAX = 0.4; // 0..1 fraction of the way from the midpoint to the launched Bey.
export const CAMERA_KNOCKBACK_FOLLOW_DECAY_PER_S = 2.5;

// --- Clash camera (Milestone 5, ClashCameraDirector.ts) — a dedicated
// cinematic orbit near the clash point while Active, intensity escalating
// with the contest's progress (0..1 fraction of the ~4s target duration):
// same "hybrid scalable" profile C direction as the rest of this file, at
// its own vantage since the two Beys are frozen close together during the
// contest rather than moving around the arena. Engineering placeholders
// (GDD section 167) — the owner-approved *shape* (dedicated orbit,
// escalating with the mash, Z/X/C staying legible) is what's approved,
// not these exact numbers.
export const CLASH_CAMERA_ORBIT_BASE_SPEED_RAD_PER_S = 0.6;
export const CLASH_CAMERA_ORBIT_EXTRA_SPEED_RAD_PER_S = 1.2;
export const CLASH_CAMERA_BASE_DISTANCE_M = 6;
export const CLASH_CAMERA_DISTANCE_PULL_IN_M = 1.5;
export const CLASH_CAMERA_HEIGHT_M = 2.5;
export const CLASH_CAMERA_FOV_BASE_DEG = 50;
export const CLASH_CAMERA_FOV_MAX_EXTRA_DEG = 10;
export const CLASH_CAMERA_SHAKE_MAX_M = 0.2;
export const CLASH_CAMERA_SHAKE_FREQUENCY_HZ = 14;
