// ============================================================
// BEY PHYSICAL PROFILE — DATA-DRIVEN COLLIDER + MASS (MILESTONE 6)
// The simplified single-collider physics envelope for one Bey archetype:
// still one cylinder (GDD section 104 permits — and the visual layer
// already uses — a collider decoupled from the render mesh; this is NOT
// four per-piece colliders), but its radius/half-height/mass are now data
// instead of the fixed BeyTuning.ts constants every prior milestone used.
// Concrete per-archetype values (BeyArchetypes.ts) are chosen to roughly
// track each archetype's 4-piece visual silhouette — an engineering
// placeholder (GDD section 167), not a final hitbox/balance decision.
// ============================================================

import { BEY_COLLIDER_HALF_HEIGHT_M, BEY_COLLIDER_RADIUS_M, BEY_MASS_KG } from '../core/BeyTuning';

export interface BeyPhysicalProfile {
  colliderRadiusM: number;
  colliderHalfHeightM: number;
  massKg: number;
}

/** Byte-identical to the single generic Bey every Milestone 1-5 self-test exercised. */
export const DEFAULT_PHYSICAL_PROFILE: BeyPhysicalProfile = {
  colliderRadiusM: BEY_COLLIDER_RADIUS_M,
  colliderHalfHeightM: BEY_COLLIDER_HALF_HEIGHT_M,
  massKg: BEY_MASS_KG,
};
