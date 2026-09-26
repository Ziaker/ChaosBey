// ============================================================
// BEY PARTICLE PROFILE — DATA-DRIVEN PER-ARCHETYPE VFX IDENTITY (MILESTONE 6)
// The remaining Milestone 6 identity axis (GDD section 6/31): Attack/
// Defense/Stamina must be able to point to different particle identities,
// not just different reach/speed (BeyAttackProfile) or a different mesh
// silhouette (BeyAppearance). This is deliberately a thin data hook, same
// spirit as BeyAttackProfile: a real (if provisional) effect, not a dead
// placeholder — VfxManager actually tints each Bey's own spark/landing
// bursts from this profile (see SparkBurstVfx.ts/LandingBurstVfx.ts).
//
// Per-archetype tints (BeyArchetypes.ts) deliberately REUSE each
// archetype's own already-provisional BeyAppearance colors rather than
// inventing new ones — no new material/color/emissive decision is made
// here (GDD section 96/97's visual approval gate is still pending).
// ============================================================

import { LANDING_RING_COLOR_HEX, SPARK_COLOR_HEX } from '../../vfx/VfxTuning';

export interface BeyParticleProfile {
  sparkTintHex: number;
  landingTintHex: number;
}

/** Byte-identical to the fixed VfxTuning constants every Milestone 4/5 self-test exercised. */
export const DEFAULT_PARTICLE_PROFILE: BeyParticleProfile = {
  sparkTintHex: SPARK_COLOR_HEX,
  landingTintHex: LANDING_RING_COLOR_HEX,
};
