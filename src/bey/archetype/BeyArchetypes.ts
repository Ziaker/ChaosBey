// ============================================================
// BEY ARCHETYPES — THREE VISUAL/GAMEPLAY PROTOTYPES (MILESTONE 6)
// GDD section 6/31's three archetypes (Attack/Defense/Stamina), expressed
// purely as data: player-facing Ratings (1-10 scale) + a Handling profile
// + mass, plus a PROTOTYPE-ONLY appearance (a distinct 4-piece silhouette
// per archetype — ring/upper body/lower weight section/driver tip, see
// createBeyMesh.ts — with color used only to tell the three apart) so the
// owner has something concrete to look at and approve.
//
// The four anatomy pieces are shared across all three archetypes; only
// their relative proportions differ, so silhouette alone (even in a single
// neutral gray) should read as Attack/Defense/Stamina. Every rating/
// handling/mass/proportion number below is an engineering placeholder for
// balance purposes (GDD section 167) and every appearance is explicitly a
// design prototype (GDD section 96/97) — none of this is final. Do not
// treat the colors, exact proportions, ratings, or which two of the three
// currently appear in createMatchScene.ts as approved/final; that decision
// is the owner's, pending the visual approval gate.
// ============================================================

import type { BeyDefinition } from './BeyDefinition';
import { DEFAULT_HANDLING_PROFILE } from './BeyHandlingProfile';
import { BEY_MASS_KG } from '../core/BeyTuning';
import { createBeyMesh } from '../procedural-model/createBeyMesh';

/**
 * Attack-type: hits harder and moves faster, at the cost of Defense and a
 * lighter body that's easier to launch. Silhouette: a pronounced, wide,
 * thick ring (top-heavy, "impact zone" reads first) over a slim body and a
 * compact tip.
 */
export const ATTACK_ARCHETYPE: BeyDefinition = {
  id: 'attack-prototype',
  name: 'Attack (Prototype)',
  massKg: BEY_MASS_KG * 0.85,
  ratings: { attack: 8, defense: 3, stamina: 4 },
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
        colorOverride: { bodyColorHex: 0xff5c5c, emissiveColorHex: 0x4a0b0b },
        proportions: {
          ringRadiusM: 0.72,
          ringHeightM: 0.18,
          upperBodyRadiusM: 0.42,
          upperBodyHeightM: 0.08,
          lowerBodyRadiusM: 0.32,
          lowerBodyHeightM: 0.08,
          tipRadiusM: 0.09,
          tipHeightM: 0.06,
        },
      }),
  },
};

/**
 * Defense-type: sturdier and heavier — takes less knockback/Stability
 * damage and grips harder, at the cost of raw offense and top speed.
 * Silhouette: a wide, tall lower weight section (low center of mass) under
 * a modest, solid ring.
 */
export const DEFENSE_ARCHETYPE: BeyDefinition = {
  id: 'defense-prototype',
  name: 'Defense (Prototype)',
  massKg: BEY_MASS_KG * 1.25,
  ratings: { attack: 3, defense: 8, stamina: 4 },
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
        colorOverride: { bodyColorHex: 0x4f8cff, emissiveColorHex: 0x0b1e4a },
        proportions: {
          ringRadiusM: 0.55,
          ringHeightM: 0.08,
          upperBodyRadiusM: 0.52,
          upperBodyHeightM: 0.1,
          lowerBodyRadiusM: 0.62,
          lowerBodyHeightM: 0.24,
          tipRadiusM: 0.17,
          tipHeightM: 0.09,
        },
      }),
  },
};

/**
 * Stamina-type: balanced handling with a larger, slower-draining Stamina
 * pool for a longer-lasting fight. Silhouette: elongated overall, with a
 * distinctly longer tip reading as "rotation endurance" — less heavy than
 * Defense, less aggressive than Attack.
 */
export const STAMINA_ARCHETYPE: BeyDefinition = {
  id: 'stamina-prototype',
  name: 'Stamina (Prototype)',
  massKg: BEY_MASS_KG,
  ratings: { attack: 4, defense: 4, stamina: 8 },
  handling: { ...DEFAULT_HANDLING_PROFILE },
  appearance: {
    // PROTOTYPE ONLY — silhouette/proportion + placeholder green, not an approved visual design.
    createVisual: () =>
      createBeyMesh({
        colorOverride: { bodyColorHex: 0x4fffb0, emissiveColorHex: 0x0b4a2e },
        proportions: {
          ringRadiusM: 0.58,
          ringHeightM: 0.1,
          upperBodyRadiusM: 0.44,
          upperBodyHeightM: 0.14,
          lowerBodyRadiusM: 0.4,
          lowerBodyHeightM: 0.14,
          tipRadiusM: 0.14,
          tipHeightM: 0.16,
        },
      }),
  },
};

export const ALL_BEY_ARCHETYPES: readonly BeyDefinition[] = [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE];
