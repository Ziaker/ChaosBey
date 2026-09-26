// ============================================================
// BEY ATTACK PROFILE — DATA-DRIVEN ATTACK REACH/SPEED (MILESTONE 6)
// The remaining Milestone 6 gameplay axis (GDD section 6/31: "attack
// behavior" differences between archetypes) not yet covered by BeyStats
// (raw force via Attack/Defense) or BeyHandlingProfile (movement): how far
// each attack's hitbox reaches and how fast a Dash Attack travels. Raw
// knockback/Stability *power* already scales with the Attack/Defense stat
// (see Knockback.ts) — this profile is specifically about REACH/SPEED, a
// separate axis, consistent with Attack's established identity ("hits
// harder and moves faster") and Defense's ("less aggressive, slower").
// Concrete per-archetype values (BeyArchetypes.ts) are Milestone 6
// engineering placeholders (GDD section 167), not final balance.
// ============================================================

import { CIRCULAR_HITBOX_RADIUS_M, DASH_HITBOX_RADIUS_M, DASH_MAX_SPEED_MPS, DASH_MIN_SPEED_MPS } from '../../combat/attacks/AttackTuning';

export interface BeyAttackProfile {
  circularHitboxRadiusM: number;
  dashHitboxRadiusM: number;
  dashMinSpeedMps: number;
  dashMaxSpeedMps: number;
}

/** Byte-identical to the single generic Bey every Milestone 1-5 self-test exercised. */
export const DEFAULT_ATTACK_PROFILE: BeyAttackProfile = {
  circularHitboxRadiusM: CIRCULAR_HITBOX_RADIUS_M,
  dashHitboxRadiusM: DASH_HITBOX_RADIUS_M,
  dashMinSpeedMps: DASH_MIN_SPEED_MPS,
  dashMaxSpeedMps: DASH_MAX_SPEED_MPS,
};
