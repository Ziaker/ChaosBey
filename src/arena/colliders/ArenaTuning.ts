// ============================================================
// ARENA — GAMEPLAY TUNING (MILESTONE 1 TEMPORARY ARENA)
// A single medium arena is the approved Milestone 0/1 content (GDD section
// 35). Shape/size become pre-game configurable later (GDD section 36:
// presets + selected sliders) — these constants are that future preset's
// first value, not a final locked design.
// ============================================================

// Radius of the circular play area, in meters. "Medium" per GDD section 35;
// not yet validated against real gameplay pacing/camera framing.
export const ARENA_FLOOR_RADIUS = 12;
export const ARENA_FLOOR_THICKNESS = 0.5;

// The boundary wall is approximated by flat box segments arranged in a
// circle (Rapier has no native "inside of a cylinder" collider shape that
// stays cheap and robust). More segments = smoother circle, more static
// colliders.
export const ARENA_WALL_SEGMENT_COUNT = 32;
export const ARENA_WALL_HEIGHT = 2;
export const ARENA_WALL_THICKNESS = 0.6;
// Segments are widened slightly beyond their exact chord length so
// adjacent segments' corners overlap a little instead of leaving a
// hairline gap a fast-moving Bey could clip through.
export const ARENA_WALL_SEGMENT_OVERLAP_FACTOR = 1.15;

// Milestone 1 has no ring-out rule yet (that's combat/round-rules,
// Milestone 2+) — the wall is a hard physical boundary for now, not a
// ring-out trigger volume.
