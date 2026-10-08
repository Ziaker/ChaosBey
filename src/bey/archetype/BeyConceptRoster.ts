// ============================================================
// THE NINE SELECTABLE BEYS — owner, 2026-10-02 (Lote 8, item 16)
// The owner approved nine Bey concepts (Attack/Defense/Stamina × A/B/C,
// VISUAL_APPROVALS_MASTER.md 3.2) as the selectable roster. Each is a real
// gameplay definition with its own id (it travels in the match setup and
// the replay), wearing its own concept visual.
//
// Concept A of each family IS the family's archetype definition (unchanged
// ids, so existing replays and seeds stand). Until 0.45.0 B and C copied
// their family's gameplay exactly; now (owner, 2026-10-07: "prossiga com tudo
// menos a 2" — polish idea 1, identity for the B and C variants) each plays
// the way its concept looks, through CONCEPT_GAMEPLAY_OVERRIDES below: a
// small, deliberate shift of handling, mass, reach and Ratings off its
// family, never a stronger Bey — every family keeps the same Ratings budget.
// All numbers are PROVISIONAL (engineering placeholders for the owner to tune).
// ============================================================

import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from './BeyArchetypes';
import type { BeyDefinition } from './BeyDefinition';
import type { BeyRatings } from './BeyRatings';
import { CONCEPTS } from '../visual/concepts/conceptDefinitions';

export type BeyFamily = 'attack' | 'defense' | 'stamina';
export type ConceptLetter = 'A' | 'B' | 'C';

export interface ConceptBey {
  /** The concept id, matching the visual concept (e.g. 'attack-b'). */
  readonly conceptId: string;
  readonly family: BeyFamily;
  readonly letter: ConceptLetter;
  readonly definition: BeyDefinition;
}

const FAMILY_ARCHETYPE: Readonly<Record<BeyFamily, BeyDefinition>> = { attack: ATTACK_ARCHETYPE, defense: DEFENSE_ARCHETYPE, stamina: STAMINA_ARCHETYPE };

/** What a variant changes off its family archetype: multipliers on the archetype's own numbers (1 = as the family). */
interface VariantShift {
  readonly mass?: number;
  readonly ratings: BeyRatings;
  readonly acceleration?: number;
  readonly topSpeed?: number;
  readonly turnRate?: number;
  readonly grip?: number;
  /** Circular and Dash hitbox reach. */
  readonly reach?: number;
  readonly dashSpeed?: number;
}

function variantOf(archetype: BeyDefinition, shift: VariantShift): Partial<Omit<BeyDefinition, 'id'>> {
  const { handling, attack, physical } = archetype;
  return {
    physical: { ...physical, massKg: physical.massKg * (shift.mass ?? 1) },
    ratings: shift.ratings,
    handling: {
      ...handling,
      accelerationMps2: handling.accelerationMps2 * (shift.acceleration ?? 1),
      maxSpeedMps: handling.maxSpeedMps * (shift.topSpeed ?? 1),
      turnRateRadS: handling.turnRateRadS * (shift.turnRate ?? 1),
      lateralGripPerS: handling.lateralGripPerS * (shift.grip ?? 1),
    },
    attack: {
      ...attack,
      circularHitboxRadiusM: attack.circularHitboxRadiusM * (shift.reach ?? 1),
      dashHitboxRadiusM: attack.dashHitboxRadiusM * (shift.reach ?? 1),
      dashMinSpeedMps: attack.dashMinSpeedMps * (shift.dashSpeed ?? 1),
      dashMaxSpeedMps: attack.dashMaxSpeedMps * (shift.dashSpeed ?? 1),
    },
  };
}

/**
 * The single point per concept to differentiate it (any BeyDefinition field but its id). Each shift follows the concept's
 * own headline (conceptDefinitions.ts) and keeps its family's Ratings total, so no variant is simply better:
 * - Attack B, asymmetric slicer: lighter and quicker to turn and to dash, shorter reach, a little less raw hit (7).
 * - Attack C, twin-hammer impactor: the heaviest hitter (9) and the longest reach, slow to turn and to accelerate.
 * - Defense B, bumper array: contact-absorbing bumpers reach a little further than a wall should and it accelerates better, for a little less defense (7) and a little more attack (4).
 * - Defense C, stepped fortress: the toughest (8) and heaviest, the slowest and grippiest, with little endurance (3).
 * - Stamina B, precision gyro: the sharpest steering and grip, a little more attack (5) for a little less endurance (7).
 * - Stamina C, aero glider: the fastest and lightest, the longest endurance (9) with the weakest defense (3).
 */
export const CONCEPT_GAMEPLAY_OVERRIDES: Readonly<Record<string, Partial<Omit<BeyDefinition, 'id'>>>> = {
  'attack-b': variantOf(ATTACK_ARCHETYPE, { mass: 0.92, ratings: { attack: 7, defense: 3, stamina: 4 }, acceleration: 1.08, topSpeed: 1.04, turnRate: 1.15, grip: 0.95, reach: 0.95, dashSpeed: 1.1 }),
  'attack-c': variantOf(ATTACK_ARCHETYPE, { mass: 1.25, ratings: { attack: 9, defense: 3, stamina: 3 }, acceleration: 0.9, topSpeed: 0.97, turnRate: 0.9, reach: 1.1, dashSpeed: 0.95 }),
  'defense-b': variantOf(DEFENSE_ARCHETYPE, { ratings: { attack: 4, defense: 7, stamina: 4 }, acceleration: 1.05, reach: 1.05 }),
  'defense-c': variantOf(DEFENSE_ARCHETYPE, { mass: 1.12, ratings: { attack: 4, defense: 8, stamina: 3 }, acceleration: 0.95, topSpeed: 0.95, turnRate: 0.95, grip: 1.1, reach: 0.95 }),
  'stamina-b': variantOf(STAMINA_ARCHETYPE, { ratings: { attack: 5, defense: 4, stamina: 7 }, turnRate: 1.15, grip: 1.15 }),
  'stamina-c': variantOf(STAMINA_ARCHETYPE, { mass: 0.92, ratings: { attack: 4, defense: 3, stamina: 9 }, acceleration: 1.1, topSpeed: 1.12, turnRate: 0.95 }),
};

function conceptBey(family: BeyFamily, letter: ConceptLetter): ConceptBey {
  const conceptId = `${family}-${letter.toLowerCase()}`;
  const archetype = FAMILY_ARCHETYPE[family];
  // The sparks and landing dust of a variant wear its own colors (the Bey's UI color and its dark second color).
  const palette = CONCEPTS.find((c) => c.id === conceptId)?.palette;
  const particle = palette ? { sparkTintHex: palette.glow, landingTintHex: palette.secondary } : archetype.particle;
  // Concept A is the archetype itself (same id and object).
  const definition: BeyDefinition =
    letter === 'A' ? archetype : { ...archetype, particle, ...CONCEPT_GAMEPLAY_OVERRIDES[conceptId], id: conceptId, name: `${archetype.name} ${letter}` };
  return { conceptId, family, letter, definition };
}

export const CONCEPT_BEYS: readonly ConceptBey[] = (['attack', 'defense', 'stamina'] as const).flatMap((family) => (['A', 'B', 'C'] as const).map((letter) => conceptBey(family, letter)));

/** All nine gameplay definitions, Attack A..C, Defense A..C, Stamina A..C. */
export const ALL_CONCEPT_BEY_DEFINITIONS: readonly BeyDefinition[] = CONCEPT_BEYS.map((c) => c.definition);

/** The concept a gameplay definition id is, or null (the generic default Bey, test definitions). */
export function conceptBeyFor(definitionId: string): ConceptBey | null {
  return CONCEPT_BEYS.find((c) => c.definition.id === definitionId) ?? null;
}

/** The family archetype a definition id belongs to (its AI personality and attack-profile settings), or null. */
export function familyArchetypeOf(definitionId: string): BeyDefinition | null {
  const concept = conceptBeyFor(definitionId);
  return concept ? FAMILY_ARCHETYPE[concept.family] : null;
}
