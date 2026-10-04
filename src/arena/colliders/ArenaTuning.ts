// ============================================================
// ARENA — GAMEPLAY TUNING (MILESTONE 1 TEMPORARY ARENA)
// A single medium arena is the approved Milestone 0/1 content (GDD section
// 35). Shape/size become pre-game configurable later (GDD section 36:
// presets + selected sliders) — these constants are that future preset's
// first value, not a final locked design.
// ============================================================

// Radius of the circular play area, in meters. Owner request (arena scale
// pass): the stage is 3x its previous size on the horizontal plane, so
// 12 m -> 36 m. Only the horizontal plane scales: wall height/thickness,
// floor thickness and the Bey itself keep their sizes.
export const ARENA_FLOOR_RADIUS = 36;
export const ARENA_FLOOR_THICKNESS = 0.5;

// The boundary wall is approximated by flat box segments arranged in a
// circle (Rapier has no native "inside of a cylinder" collider shape that
// stays cheap and robust). More segments = smoother circle, more static
// colliders. 3x the radius needs 3x the segments (32 -> 96) to keep the
// same ~2.4 m chord, so the polygon's sagitta (how far a segment's middle
// sits inside the circle) stays a few centimetres instead of tripling.
export const ARENA_WALL_SEGMENT_COUNT = 96;
export const ARENA_WALL_HEIGHT = 2;
export const ARENA_WALL_THICKNESS = 0.6;
// Segments are widened slightly beyond their exact chord length so
// adjacent segments' corners overlap a little instead of leaving a
// hairline gap a fast-moving Bey could clip through.
export const ARENA_WALL_SEGMENT_OVERLAP_FACTOR = 1.15;

// Milestone 1 has no ring-out rule yet (that's combat/round-rules,
// Milestone 2+) — the wall is a hard physical boundary for now, not a
// ring-out trigger volume.

/**
 * Owner, 2026-10-04 ("adicione como slider também o tamanho do stage"): the match's stage size, × the 36 m floor
 * radius (MatchConfig.arenaSizeScale). Set by createArenaColliders when a match's arena is built — every reader of the
 * floor radius (floor profile, walls, ring-out, AI edge sense, camera containment) asks arenaFloorRadius().
 */
let activeArenaSizeScale = 1;
export function setArenaSizeScale(scale: number): void {
  activeArenaSizeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
}
export function arenaSizeScale(): number {
  return activeArenaSizeScale;
}
export function arenaFloorRadius(): number {
  return ARENA_FLOOR_RADIUS * activeArenaSizeScale;
}
