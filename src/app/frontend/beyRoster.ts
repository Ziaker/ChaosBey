// ============================================================
// BEY ROSTER — WHAT CHARACTER SELECT SHOWS (M10)
// The player-facing view of the playable Bey definitions: a label, a short
// role description and the numbers the screen draws, all derived from the
// definition's own data. Nothing here feeds the simulation; a match is
// built from the BeyDefinition itself.
//
// Owner, 2026-10-02 (Lote 8): the nine approved Bey concepts
// (VISUAL_APPROVALS_MASTER.md 3.2) are the roster — Attack/Defense/Stamina
// A/B/C, each its own gameplay definition (BeyConceptRoster.ts) wearing its
// own concept visual. Labels are the family + letter with the concept's
// headline as the role: final Bey names are still open (3.3). B and C play
// exactly like their family for now (PROVISIONAL, said on the card).
// ============================================================

import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../bey/archetype/BeyArchetypes';
import { CONCEPT_BEYS, familyArchetypeOf, type ConceptBey } from '../../bey/archetype/BeyConceptRoster';
import { CONCEPTS } from '../../bey/visual/concepts/conceptDefinitions';
import { DEFAULT_ATTACK_PROFILE } from '../../bey/archetype/BeyAttackProfile';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import { DEFAULT_HANDLING_PROFILE } from '../../bey/archetype/BeyHandlingProfile';
import { BEY_MASS_KG } from '../../bey/core/BeyTuning';

export interface RosterEntry {
  readonly definition: BeyDefinition;
  /** Short uppercase label, e.g. "ATTACK". */
  readonly label: string;
  /** One line under the label. */
  readonly role: string;
  /** Two or three sentences on how it plays. */
  readonly description: string;
  /** CSS color for this Bey's accents (its prototype body color). */
  readonly accentCss: string;
}

/** Relative handling facts, 1.0 = the default Bey. */
export interface RosterTraits {
  readonly weight: number;
  readonly topSpeed: number;
  readonly acceleration: number;
  readonly grip: number;
  readonly reach: number;
  readonly dashSpeed: number;
}

interface RosterCopy {
  readonly label: string;
  readonly role: string;
  readonly description: string;
  readonly accentCss: string;
}

const COPY: Readonly<Record<string, RosterCopy>> = {
  [ATTACK_ARCHETYPE.id]: {
    label: 'ATTACK',
    role: 'Aggressive striker',
    description: 'Hits hardest and moves fastest, with the longest reach and quickest Dash. Light, so it gets launched easily and tires sooner.',
    accentCss: '#ff5c5c',
  },
  [DEFENSE_ARCHETYPE.id]: {
    label: 'DEFENSE',
    role: 'Heavy wall',
    description: 'The heaviest and grippiest. Shrugs off knockback and Stability damage, but is slower, turns wider and has the shortest reach.',
    accentCss: '#4f8cff',
  },
  [STAMINA_ARCHETYPE.id]: {
    label: 'STAMINA',
    role: 'Endurance spinner',
    description: 'Balanced handling and the biggest, slowest-draining Stamina pool. Wins long fights by outlasting the opponent.',
    accentCss: '#4fffb0',
  },
};

function entryFor(concept: ConceptBey): RosterEntry {
  const family = familyArchetypeOf(concept.definition.id)!;
  const copy = COPY[family.id];
  const visual = CONCEPTS.find((c) => c.id === concept.conceptId);
  if (!copy || !visual) throw new Error(`beyRoster: no roster copy or concept for Bey definition "${concept.definition.id}".`);
  const description = concept.letter === 'A' ? copy.description : `${copy.description} Plays exactly like ${copy.label} A for now (provisional).`;
  return { definition: concept.definition, label: `${copy.label} ${concept.letter}`, role: visual.headline, description, accentCss: copy.accentCss };
}

export const BEY_ROSTER: readonly RosterEntry[] = CONCEPT_BEYS.map(entryFor);

export function findRosterEntry(definitionId: string): RosterEntry | null {
  return BEY_ROSTER.find((e) => e.definition.id === definitionId) ?? null;
}

export function rosterEntry(definitionId: string): RosterEntry {
  const entry = findRosterEntry(definitionId);
  if (!entry) throw new Error(`beyRoster: unknown Bey "${definitionId}".`);
  return entry;
}

export function rosterTraits(definition: BeyDefinition): RosterTraits {
  return {
    weight: definition.physical.massKg / BEY_MASS_KG,
    topSpeed: definition.handling.maxSpeedMps / DEFAULT_HANDLING_PROFILE.maxSpeedMps,
    acceleration: definition.handling.accelerationMps2 / DEFAULT_HANDLING_PROFILE.accelerationMps2,
    grip: definition.handling.lateralGripPerS / DEFAULT_HANDLING_PROFILE.lateralGripPerS,
    reach: definition.attack.dashHitboxRadiusM / DEFAULT_ATTACK_PROFILE.dashHitboxRadiusM,
    dashSpeed: definition.attack.dashMaxSpeedMps / DEFAULT_ATTACK_PROFILE.dashMaxSpeedMps,
  };
}

/** "+15%", "−10%" or "±0%" for a relative trait. */
export function formatTrait(ratio: number): string {
  const percent = Math.round((ratio - 1) * 100);
  if (percent === 0) return '±0%';
  return percent > 0 ? `+${percent}%` : `−${-percent}%`;
}
