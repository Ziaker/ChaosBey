// ============================================================
// CAMERA TUNING — HITSTOP
// Milestone 4's hitstop (a brief simulation freeze on a strong impact;
// owned by app/simulation/Hitstop.ts since M9). The combat camera itself
// is the approved director (camera/director/, M11 lane 2,
// docs/design-decisions/camera-approval.md): its framing, speed FOV,
// shake, knockback follow and Clash camera replace the M4/M5 engineering
// constants that used to live here (CombatCameraController and
// ClashCameraDirector). Hitstop stays as it was, separate from the
// director (camera-approval.md 10.6).
// ============================================================

// Below this impact magnitude, no hitstop at all.
export const CAMERA_HITSTOP_MIN_MAGNITUDE = 0.35;
export const CAMERA_HITSTOP_DURATION_PER_MAGNITUDE_S = 0.18;
export const CAMERA_HITSTOP_MAX_DURATION_S = 0.18;
