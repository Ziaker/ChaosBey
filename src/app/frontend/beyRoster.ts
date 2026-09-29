// ============================================================
// BEY ROSTER — WHAT CHARACTER SELECT SHOWS (M10)
// The player-facing view of the playable Bey definitions: a label, a short
// role description and the numbers the screen draws, all derived from the
// definition's own data. Nothing here feeds the simulation; a match is
// built from the BeyDefinition itself.
//
// The roster is the three archetype definitions the game has today
// (BeyArchetypes.ts). The owner has approved nine Bey concepts as the
// final selectable roster (VISUAL_APPROVALS_MASTER.md 3.2); they become
// entries here once they exist as gameplay definitions. Names stay the
// archetype names: final Bey names are still open (3.3).
// ============================================================

import { ALL_BEY_ARCHETYPES, ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../bey/archetype/BeyArchetypes';
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

function entryFor(definition: BeyDefinition): RosterEntry {
  const copy = COPY[definition.id];
  if (!copy) throw new Error(`beyRoster: no roster copy for Bey definition "${definition.id}".`);
  return { definition, ...copy };
}

export const BEY_ROSTER: readonly RosterEntry[] = ALL_BEY_ARCHETYPES.map(entryFor);

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
