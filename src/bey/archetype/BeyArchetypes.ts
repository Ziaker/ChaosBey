// ============================================================
// BEY ARCHETYPES — THREE VISUAL/GAMEPLAY PROTOTYPES (MILESTONE 6)
// GDD section 6/31's three archetypes (Attack/Defense/Stamina), expressed
// purely as data: player-facing Ratings (1-10 scale) + a Handling profile
// + a Physical profile, plus a PROTOTYPE-ONLY appearance (a distinct
// "tornado/mechanical top" silhouette per archetype — ring/upper body/
// lower weight section/driver tip, continuously tapered per owner
// direction (visual round 2), see createBeyMesh.ts — with color used only
// to tell the three apart) so the owner has something concrete to look at
// and approve.
//
// The four anatomy pieces are shared across all three archetypes; only
// their relative proportions differ, so silhouette alone (even in a single
// neutral gray) should read as Attack/Defense/Stamina. Every rating/
// handling/physical/proportion number below is an engineering placeholder
// for balance purposes (GDD section 167) and every appearance is
// explicitly a design prototype (GDD section 96/97) — none of this is
// final. Do not treat the colors, exact proportions, ratings, or which two
// of the three currently appear in createMatchScene.ts as approved/final;
// that decision is the owner's, pending the visual approval gate.
// ============================================================

import { DEFAULT_ATTACK_PROFILE, type BeyAttackProfile } from './BeyAttackProfile';
import { DEFAULT_AUDIO_PROFILE, type BeyAudioProfile } from './BeyAudioProfile';
import type { BeyDefinition } from './BeyDefinition';
import { DEFAULT_HANDLING_PROFILE } from './BeyHandlingProfile';
import type { BeyParticleProfile } from './BeyParticleProfile';
import type { BeyPhysicalProfile } from './BeyPhysicalProfile';
import { BEY_MASS_KG } from '../core/BeyTuning';
import { createBeyMesh } from '../procedural-model/createBeyMesh';

/**
 * Attack-type: reaches further and dashes faster, consistent with its
 * established "hits harder and moves faster" identity — a separate axis
 * from the raw knockback/Stability power already carried by its Ratings
 * (see BeyAttackProfile.ts). Engineering placeholder (GDD section 167).
 */
export const ATTACK_ATTACK_PROFILE: BeyAttackProfile = {
  circularHitboxRadiusM: DEFAULT_ATTACK_PROFILE.circularHitboxRadiusM * 1.15,
  dashHitboxRadiusM: DEFAULT_ATTACK_PROFILE.dashHitboxRadiusM * 1.15,
  dashMinSpeedMps: DEFAULT_ATTACK_PROFILE.dashMinSpeedMps * 1.1,
  dashMaxSpeedMps: DEFAULT_ATTACK_PROFILE.dashMaxSpeedMps * 1.1,
};

/**
 * Defense-type: shorter reach and a slower Dash, consistent with its
 * established "less aggressive, slower" identity. Engineering placeholder
 * (GDD section 167).
 */
export const DEFENSE_ATTACK_PROFILE: BeyAttackProfile = {
  circularHitboxRadiusM: DEFAULT_ATTACK_PROFILE.circularHitboxRadiusM * 0.9,
  dashHitboxRadiusM: DEFAULT_ATTACK_PROFILE.dashHitboxRadiusM * 0.9,
  dashMinSpeedMps: DEFAULT_ATTACK_PROFILE.dashMinSpeedMps * 0.85,
  dashMaxSpeedMps: DEFAULT_ATTACK_PROFILE.dashMaxSpeedMps * 0.85,
};

/**
 * Attack-type: hits harder and moves faster, at the cost of Defense and a
 * lighter body that's easier to launch. Silhouette: the widest, most
 * flared-open ring (top-heavy, "impact zone" reads first), tapering
 * continuously — but relatively quickly — down through a slim mid-body to
 * a compact-but-real driver tip. The physical collider is widened/
 * flattened to roughly track that same silhouette (still one simplified
 * cylinder, not per-piece colliders — GDD section 104).
 */
const ATTACK_PHYSICAL: BeyPhysicalProfile = { colliderRadiusM: 0.65, colliderHalfHeightM: 0.18, massKg: BEY_MASS_KG * 0.85 };

// Placeholder red — same prototype colors as the mesh's colorOverride
// below, reused (not reinvented) as this archetype's spark/landing VFX
// tint, so Attack's particle identity doesn't introduce a second color
// decision (GDD section 96/97's approval gate is still pending either way).
const ATTACK_BODY_COLOR_HEX = 0xff5c5c;
const ATTACK_EMISSIVE_COLOR_HEX = 0x4a0b0b;
const ATTACK_PARTICLE_PROFILE: BeyParticleProfile = { sparkTintHex: ATTACK_BODY_COLOR_HEX, landingTintHex: ATTACK_EMISSIVE_COLOR_HEX };
const ATTACK_AUDIO_PROFILE: BeyAudioProfile = { hitCueId: 'attack-prototype-hit', dashCueId: 'attack-prototype-dash' };

export const ATTACK_ARCHETYPE: BeyDefinition = {
  id: 'attack-prototype',
  name: 'Attack (Prototype)',
  physical: ATTACK_PHYSICAL,
  ratings: { attack: 8, defense: 3, stamina: 4 },
  attack: ATTACK_ATTACK_PROFILE,
  particle: ATTACK_PARTICLE_PROFILE,
  audio: ATTACK_AUDIO_PROFILE,
  handling: {
    ...DEFAULT_HANDLING_PROFILE,
    accelerationMps2: DEFAULT_HANDLING_PROFILE.accelerationMps2 * 1.2,
    maxSpeedMps: DEFAULT_HANDLING_PROFILE.maxSpeedMps * 1.15,
    turnRateRadS: DEFAULT_HANDLING_PROFILE.turnRateRadS * 1.1,
    lateralGripPerS: DEFAULT_HANDLING_PROFILE.lateralGripPerS * 0.9,
  },
  appearance: {
    // PROTOTYPE ONLY — silhouette/proportion + placeholder red, not an approved visual design.
    createVisual: () =>
      createBeyMesh({
        colorOverride: { bodyColorHex: ATTACK_BODY_COLOR_HEX, emissiveColorHex: ATTACK_EMISSIVE_COLOR_HEX },
        colliderHalfHeightM: ATTACK_PHYSICAL.colliderHalfHeightM,
        proportions: {
          ring: { topRadiusM: 0.75, bottomRadiusM: 0.55, heightM: 0.14 },
          upperBody: { topRadiusM: 0.55, bottomRadiusM: 0.4, heightM: 0.12 },
          lowerBody: { topRadiusM: 0.4, bottomRadiusM: 0.22, heightM: 0.22 },
          tip: { topRadiusM: 0.22, bottomRadiusM: 0.02, heightM: 0.16 },
        },
      }),
  },
};

/**
 * Defense-type: sturdier and heavier — takes less knockback/Stability
 * damage and grips harder, at the cost of raw offense and top speed.
 * Silhouette: a modest, solid (not flared-open) ring, tapering gently into
 * a thick, tall mid/lower body — the most voluminous of the three, reading
 * as low-center-of-mass and heavy — before converging into a sturdy tip.
 * The physical collider is wider and taller to roughly track that heavier,
 * taller silhouette.
 */
const DEFENSE_PHYSICAL: BeyPhysicalProfile = { colliderRadiusM: 0.62, colliderHalfHeightM: 0.27, massKg: BEY_MASS_KG * 1.25 };

// Placeholder blue — reused (not reinvented) from the mesh's colorOverride
// below, same reasoning as Attack's particle profile.
const DEFENSE_BODY_COLOR_HEX = 0x4f8cff;
const DEFENSE_EMISSIVE_COLOR_HEX = 0x0b1e4a;
const DEFENSE_PARTICLE_PROFILE: BeyParticleProfile = { sparkTintHex: DEFENSE_BODY_COLOR_HEX, landingTintHex: DEFENSE_EMISSIVE_COLOR_HEX };
const DEFENSE_AUDIO_PROFILE: BeyAudioProfile = { hitCueId: 'defense-prototype-hit', dashCueId: 'defense-prototype-dash' };

export const DEFENSE_ARCHETYPE: BeyDefinition = {
  id: 'defense-prototype',
  name: 'Defense (Prototype)',
  physical: DEFENSE_PHYSICAL,
  ratings: { attack: 3, defense: 8, stamina: 4 },
  attack: DEFENSE_ATTACK_PROFILE,
  particle: DEFENSE_PARTICLE_PROFILE,
  audio: DEFENSE_AUDIO_PROFILE,
  handling: {
    ...DEFAULT_HANDLING_PROFILE,
    accelerationMps2: DEFAULT_HANDLING_PROFILE.accelerationMps2 * 0.85,
    maxSpeedMps: DEFAULT_HANDLING_PROFILE.maxSpeedMps * 0.85,
    turnRateRadS: DEFAULT_HANDLING_PROFILE.turnRateRadS * 0.9,
    lateralGripPerS: DEFAULT_HANDLING_PROFILE.lateralGripPerS * 1.25,
  },
  appearance: {
    // PROTOTYPE ONLY — silhouette/proportion + placeholder blue, not an approved visual design.
    createVisual: () =>
      createBeyMesh({
        colorOverride: { bodyColorHex: DEFENSE_BODY_COLOR_HEX, emissiveColorHex: DEFENSE_EMISSIVE_COLOR_HEX },
        colliderHalfHeightM: DEFENSE_PHYSICAL.colliderHalfHeightM,
        proportions: {
          ring: { topRadiusM: 0.62, bottomRadiusM: 0.56, heightM: 0.1 },
          upperBody: { topRadiusM: 0.56, bottomRadiusM: 0.52, heightM: 0.12 },
          lowerBody: { topRadiusM: 0.52, bottomRadiusM: 0.36, heightM: 0.28 },
          tip: { topRadiusM: 0.36, bottomRadiusM: 0.03, heightM: 0.14 },
        },
      }),
  },
};

/**
 * Stamina-type: balanced handling with a larger, slower-draining Stamina
 * pool for a longer-lasting fight. Silhouette: a moderate ring tapering
 * smoothly and evenly all the way down, with the most distinctly elongated
 * driver tip of the three — reading as "rotation endurance" — less heavy
 * than Defense, less aggressive than Attack. The physical collider is
 * moderately taller than default to roughly track the elongated body/tip,
 * radius left close to default.
 */
const STAMINA_PHYSICAL: BeyPhysicalProfile = { colliderRadiusM: 0.58, colliderHalfHeightM: 0.24, massKg: BEY_MASS_KG };

// Placeholder green — reused (not reinvented) from the mesh's
// colorOverride below, same reasoning as Attack's particle profile.
const STAMINA_BODY_COLOR_HEX = 0x4fffb0;
const STAMINA_EMISSIVE_COLOR_HEX = 0x0b4a2e;
const STAMINA_PARTICLE_PROFILE: BeyParticleProfile = { sparkTintHex: STAMINA_BODY_COLOR_HEX, landingTintHex: STAMINA_EMISSIVE_COLOR_HEX };
const STAMINA_AUDIO_PROFILE: BeyAudioProfile = { hitCueId: 'stamina-prototype-hit', dashCueId: 'stamina-prototype-dash' };

export const STAMINA_ARCHETYPE: BeyDefinition = {
  id: 'stamina-prototype',
  name: 'Stamina (Prototype)',
  physical: STAMINA_PHYSICAL,
  ratings: { attack: 4, defense: 4, stamina: 8 },
  attack: DEFAULT_ATTACK_PROFILE,
  particle: STAMINA_PARTICLE_PROFILE,
  audio: STAMINA_AUDIO_PROFILE,
  handling: { ...DEFAULT_HANDLING_PROFILE },
  appearance: {
    // PROTOTYPE ONLY — silhouette/proportion + placeholder green, not an approved visual design.
    createVisual: () =>
      createBeyMesh({
        colorOverride: { bodyColorHex: STAMINA_BODY_COLOR_HEX, emissiveColorHex: STAMINA_EMISSIVE_COLOR_HEX },
        colliderHalfHeightM: STAMINA_PHYSICAL.colliderHalfHeightM,
        proportions: {
          ring: { topRadiusM: 0.6, bottomRadiusM: 0.48, heightM: 0.1 },
          upperBody: { topRadiusM: 0.48, bottomRadiusM: 0.38, heightM: 0.14 },
          lowerBody: { topRadiusM: 0.38, bottomRadiusM: 0.24, heightM: 0.2 },
          tip: { topRadiusM: 0.24, bottomRadiusM: 0.02, heightM: 0.22 },
        },
      }),
  },
};

export const ALL_BEY_ARCHETYPES: readonly BeyDefinition[] = [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE];
