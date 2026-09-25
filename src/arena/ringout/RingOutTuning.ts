// ============================================================
// RING-OUT — GAMEPLAY TUNING
// GDD section 130: ring-out detection must stay separate from the wall
// collider — a distinct "has this Bey left the valid gameplay region"
// trigger volume, not a side effect of collision response, so that
// changing the physical arena (collider shape, wall thickness, a future
// preset) can never silently change the ring-out rule. Since the arena
// wall is a real physical barrier (GDD section 37: walls are gameplay,
// not a boundary clamp), the only way out is airborne, over the wall — a
// strong knockback launch (GDD section 27 upward component).
//
// This is its own gameplay value, not derived from ARENA_FLOOR_RADIUS/
// ARENA_WALL_THICKNESS. It happens to land just beyond the M1/M2 temporary
// arena's wall outer face right now (there's only one arena preset so
// far), but that's coincidence, not a structural link — a future arena
// preset can change its physical size without this value moving.
export const RINGOUT_RADIUS_M = 12.9;
