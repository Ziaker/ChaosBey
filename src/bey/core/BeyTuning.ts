// ============================================================
// BEY — PHYSICAL BODY TUNING (MILESTONE 1 TEMPORARY BEY)
// One temporary Bey for the movement prototype (GDD section 137). Exact
// per-archetype dimensions/mass are Milestone 6 balance data — these are
// engineering placeholders for a single generic Bey, not final numbers
// (GDD section 167).
// ============================================================

// Collider shape: a short cylinder, matching a spinning-top silhouette
// closely enough for physics purposes without needing the final
// procedural/imported model (GDD section 104: collider is never coupled
// to the visual mesh).
export const BEY_COLLIDER_RADIUS_M = 0.6;
export const BEY_COLLIDER_HALF_HEIGHT_M = 0.2;

// Mass in kg. GDD section 127: raw Rapier mass matters physically, but
// final character balance should not rely on it alone — gameplay
// modifiers layer on top once archetypes exist.
export const BEY_MASS_KG = 1.4;

export const BEY_SPAWN_HEIGHT_M = 0.6;
