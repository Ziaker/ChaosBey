// ============================================================
// THE NINE SELECTABLE BEYS — owner, 2026-10-02 (Lote 8, item 16)
// The owner approved nine Bey concepts (Attack/Defense/Stamina × A/B/C,
// VISUAL_APPROVALS_MASTER.md 3.2) as the selectable roster. Each is a real
// gameplay definition with its own id (it travels in the match setup and
// the replay), wearing its own concept visual.
//
// PROVISIONAL, explicitly: no stats were invented. Concept A of each family
// IS the family's archetype definition (unchanged ids, so existing replays
// and seeds stand); B and C copy their family's gameplay exactly. The one
// place to make a concept play differently later is CONCEPT_GAMEPLAY_OVERRIDES
// below (empty today — the owner decides the differences).
// ============================================================

import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from './BeyArchetypes';
import type { BeyDefinition } from './BeyDefinition';

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

/**
 * The single point per concept for the owner to differentiate it later (any BeyDefinition field but its id).
 * Empty = the family's gameplay exactly.
 */
export const CONCEPT_GAMEPLAY_OVERRIDES: Readonly<Record<string, Partial<Omit<BeyDefinition, 'id'>>>> = {};

function conceptBey(family: BeyFamily, letter: ConceptLetter): ConceptBey {
  const conceptId = `${family}-${letter.toLowerCase()}`;
  const archetype = FAMILY_ARCHETYPE[family];
  // Concept A is the archetype itself (same id and object).
  const definition: BeyDefinition =
    letter === 'A' ? archetype : { ...archetype, ...CONCEPT_GAMEPLAY_OVERRIDES[conceptId], id: conceptId, name: `${archetype.name} ${letter}` };
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
