// ============================================================
// BEY ARCHETYPES — THREE VISUAL/GAMEPLAY PROTOTYPES (MILESTONE 6)
// GDD section 6/31's three archetypes (Attack/Defense/Stamina), expressed
// purely as data: Stats + a Handling profile + mass, plus a PROTOTYPE-ONLY
// appearance (color-only differentiation on the existing placeholder
// mesh) so the owner has something concrete to look at and approve.
//
// Every stat/handling/mass number below is an engineering placeholder for
// balance purposes (GDD section 167) and every appearance is explicitly a
// prototype (GDD section 96/97) — none of this is final. Do not treat the
// colors, the exact multipliers, or which two of the three currently
// appear in createMatchScene.ts as approved/final; that decision is the
// owner's, pending the visual approval gate.
// ============================================================

import type { BeyDefinition } from './BeyDefinition';
import { DEFAULT_HANDLING_PROFILE } from './BeyHandlingProfile';
import { BEY_MASS_KG } from '../core/BeyTuning';
import { createBeyMesh } from '../procedural-model/createBeyMesh';

/** Attack-type: hits harder and moves faster, at the cost of Defense and a lighter body that's easier to launch. */
export const ATTACK_ARCHETYPE: BeyDefinition = {
  id: 'attack-prototype',
  name: 'Attack (Prototype)',
  massKg: BEY_MASS_KG * 0.85,
  stats: { attack: 1.3, defense: 0.8, stamina: 0.9 },
  handling: {
    ...DEFAULT_HANDLING_PROFILE,
    accelerationMps2: DEFAULT_HANDLING_PROFILE.accelerationMps2 * 1.2,
    maxSpeedMps: DEFAULT_HANDLING_PROFILE.maxSpeedMps * 1.15,
    turnRateRadS: DEFAULT_HANDLING_PROFILE.turnRateRadS * 1.1,
    lateralGripPerS: DEFAULT_HANDLING_PROFILE.lateralGripPerS * 0.9,
  },
  // PROTOTYPE COLOR ONLY — placeholder red, not an approved visual design.
  appearance: { createVisual: () => createBeyMesh({ bodyColorHex: 0xff5c5c, emissiveColorHex: 0x4a0b0b }) },
};

/** Defense-type: sturdier and heavier — takes less knockback/Stability damage and grips harder, at the cost of raw offense and top speed. */
export const DEFENSE_ARCHETYPE: BeyDefinition = {
  id: 'defense-prototype',
  name: 'Defense (Prototype)',
  massKg: BEY_MASS_KG * 1.25,
  stats: { attack: 0.8, defense: 1.3, stamina: 0.9 },
  handling: {
    ...DEFAULT_HANDLING_PROFILE,
    accelerationMps2: DEFAULT_HANDLING_PROFILE.accelerationMps2 * 0.85,
    maxSpeedMps: DEFAULT_HANDLING_PROFILE.maxSpeedMps * 0.85,
    turnRateRadS: DEFAULT_HANDLING_PROFILE.turnRateRadS * 0.9,
    lateralGripPerS: DEFAULT_HANDLING_PROFILE.lateralGripPerS * 1.25,
  },
  // PROTOTYPE COLOR ONLY — placeholder blue, not an approved visual design.
  appearance: { createVisual: () => createBeyMesh({ bodyColorHex: 0x4f8cff, emissiveColorHex: 0x0b1e4a }) },
};

/** Stamina-type: balanced handling with a larger, slower-draining Stamina pool for a longer-lasting fight. */
export const STAMINA_ARCHETYPE: BeyDefinition = {
  id: 'stamina-prototype',
  name: 'Stamina (Prototype)',
  massKg: BEY_MASS_KG,
  stats: { attack: 0.9, defense: 0.9, stamina: 1.3 },
  handling: { ...DEFAULT_HANDLING_PROFILE },
  // PROTOTYPE COLOR ONLY — placeholder green, not an approved visual design.
  appearance: { createVisual: () => createBeyMesh({ bodyColorHex: 0x4fffb0, emissiveColorHex: 0x0b4a2e }) },
};

export const ALL_BEY_ARCHETYPES: readonly BeyDefinition[] = [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE];
