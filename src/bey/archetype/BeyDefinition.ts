// ============================================================
// BEY DEFINITION — COMBINED ARCHETYPE DATA (MILESTONE 6)
// Everything createBey() needs to build one concrete Bey: its identity, a
// data-driven Physical profile (collider radius/half-height + mass — see
// BeyPhysicalProfile.ts), player-facing Ratings (GDD section 6/31's 1-10
// scale — see BeyRatings.ts; resolved into internal BeyStats multipliers
// once at creation time, see BeyStatsResolution.ts and Bey.ts), movement
// Handling, an Attack profile (hitbox reach + Dash speed — see
// BeyAttackProfile.ts; raw knockback/Stability *power* stays on
// BeyStats.attack/defense, this is specifically reach/speed), a Particle
// identity (spark/landing VFX tint — see BeyParticleProfile.ts; real
// consumer is VfxManager) and an Audio identity (cue IDs only, no
// playback engine yet — see BeyAudioProfile.ts), and (separately,
// decoupled) visual Appearance. Loaders/factories elsewhere just select
// one of these — no system outside this package decides archetype
// numbers itself (GDD section 1.4).
// ============================================================

import type { BeyAppearance } from './BeyAppearance';
import { DEFAULT_ATTACK_PROFILE, type BeyAttackProfile } from './BeyAttackProfile';
import { DEFAULT_AUDIO_PROFILE, type BeyAudioProfile } from './BeyAudioProfile';
import { DEFAULT_HANDLING_PROFILE, type BeyHandlingProfile } from './BeyHandlingProfile';
import { DEFAULT_PARTICLE_PROFILE, type BeyParticleProfile } from './BeyParticleProfile';
import { DEFAULT_PHYSICAL_PROFILE, type BeyPhysicalProfile } from './BeyPhysicalProfile';
import { NEUTRAL_BEY_RATINGS, type BeyRatings } from './BeyRatings';
import { createBeyMesh } from '../procedural-model/createBeyMesh';

export interface BeyDefinition {
  readonly id: string;
  readonly name: string;
  readonly physical: BeyPhysicalProfile;
  readonly ratings: BeyRatings;
  readonly handling: BeyHandlingProfile;
  readonly attack: BeyAttackProfile;
  readonly particle: BeyParticleProfile;
  readonly audio: BeyAudioProfile;
  readonly appearance: BeyAppearance;
}

/**
 * The single generic Bey every Milestone 1-5 self-test and scene exercised
 * — default physical profile, neutral (5/10) ratings, default handling,
 * default attack/particle/audio profiles, and the plain placeholder mesh
 * with no color override. createBey() defaults to this, so anything that
 * doesn't yet pass an explicit BeyDefinition keeps its exact prior
 * behavior.
 */
export const DEFAULT_BEY_DEFINITION: BeyDefinition = {
  id: 'default',
  name: 'Default',
  physical: DEFAULT_PHYSICAL_PROFILE,
  ratings: NEUTRAL_BEY_RATINGS,
  handling: DEFAULT_HANDLING_PROFILE,
  attack: DEFAULT_ATTACK_PROFILE,
  particle: DEFAULT_PARTICLE_PROFILE,
  audio: DEFAULT_AUDIO_PROFILE,
  appearance: { createVisual: () => createBeyMesh({ colliderHalfHeightM: DEFAULT_PHYSICAL_PROFILE.colliderHalfHeightM }) },
};
