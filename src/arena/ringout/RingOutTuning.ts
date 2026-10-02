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
// ARENA_WALL_THICKNESS. It happens to land just beyond the temporary
// arena's wall outer face right now, but that's coincidence, not a
// structural link — a future arena preset can change its physical size
// without this value moving.
//
// Arena scale pass (12 m -> 36 m floor): this value was moved on purpose,
// by hand, to keep the same 0.9 m reach past the floor edge it always had
// (0.6 m past the wall's outer face): 12.9 -> 36.9. It is deliberately NOT
// 3x (38.7): the ring-out rule is "got over the wall", and a 2.7 m
// no-man's-land past the wall would change that rule, not just the scale.
export const RINGOUT_RADIUS_M = 36.9;
