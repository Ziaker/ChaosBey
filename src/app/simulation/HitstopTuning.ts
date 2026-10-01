// ============================================================
// HITSTOP TUNING
// Milestone 4's hitstop: a brief SIMULATION freeze on a strong impact,
// owned by app/simulation/Hitstop.ts (gameplay, not presentation — it
// lives here, outside src/camera/, so that no gameplay module ever needs
// to import from the camera; see docs/design-decisions/
// camera-gameplay-separation.md). The camera director only OBSERVES the
// freeze (camera-approval.md 10.6).
// ============================================================

// Below this impact magnitude, no hitstop at all.
export const HITSTOP_MIN_MAGNITUDE = 0.35;
export const HITSTOP_DURATION_PER_MAGNITUDE_S = 0.18;
export const HITSTOP_MAX_DURATION_S = 0.18;
