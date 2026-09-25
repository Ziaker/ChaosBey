// ============================================================
// PHYSICS MATERIALS — GAMEPLAY TUNING
// Restitution (bounciness) and friction for the surfaces a Bey interacts
// with (GDD section 18 "Collision": restitution, floor bounce, wall
// bounce, scrape friction, wall friction). Centralized here so no surface
// gets a magic restitution/friction number defined inline where it's used.
// ============================================================

export interface SurfaceMaterial {
  /** 0 = no bounce (fully absorbed), 1 = perfectly elastic. Values above ~0.6 start feeling "superball"-like. */
  restitution: number;
  /** Coulomb friction coefficient. Higher = more speed lost sliding along the surface (scrape). */
  friction: number;
}

export const FLOOR_MATERIAL: SurfaceMaterial = {
  restitution: 0.15, // Floor should mostly absorb vertical bounce; the Bey stays grounded, not bouncing around from normal driving.
  friction: 0.6, // Baseline floor grip contribution; real steering grip is handled separately by MovementTuning, this only affects raw physical sliding/scrape.
};

export const WALL_MATERIAL: SurfaceMaterial = {
  restitution: 0.55, // Walls should give a clear, readable bounce-back (GDD section 37: wall interactions are gameplay, not just a boundary clamp).
  friction: 0.25, // Lower friction so a Bey can scrape along a wall at a shallow angle instead of snagging dead.
};

export const BEY_MATERIAL: SurfaceMaterial = {
  restitution: 0.35, // The Bey's own collider surface, used when computing combined restitution with whatever it hits.
  friction: 0.4,
};

/** Rapier combines two colliders' restitution/friction (default: max). We just feed each collider its own material — no combine-rule override needed yet. */
