// ============================================================
// RING-OUT — GAMEPLAY TUNING
// GDD section 130: ring-out detection must stay separate from the wall
// collider — a distinct "has this Bey left the valid gameplay region"
// trigger volume, not a side effect of collision response. Since the
// arena wall is a real physical barrier (GDD section 37: walls are
// gameplay, not a boundary clamp), the only way out is airborne, over the
// wall — a strong knockback launch (GDD section 27 upward component).
// ============================================================

// Must be clearly beyond the wall's own outer face, not just past the
// inner floor radius, so a normal wall bounce never spuriously triggers a
// ring-out.
export const RINGOUT_MARGIN_BEYOND_WALL_M = 0.3;
