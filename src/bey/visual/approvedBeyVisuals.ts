// ============================================================
// APPROVED BEY VISUALS — the nine concepts, registered as visuals
// All nine concepts are approved as the visual roster (owner override
// 2026-09-27). Only the three gameplay archetypes exist as definitions, so the
// other six are registered but assigned to nothing: they are visual-only until
// their gameplay exists, and no stat, mass, name or balance is invented here.
//
// PROVISIONAL mapping, to be replaced when the owner chooses: each existing
// archetype wears the "A" concept of its own family. Final names and palettes
// are still open (VISUAL_APPROVALS_MASTER.md 3.3).
//
// Nothing here is consulted unless the `newBeyVisuals` flag is on (on in the
// normal game since 0.16.0; see src/presentation/features.ts).
// ============================================================

import { CONCEPT_BEYS } from '../archetype/BeyConceptRoster';
import { BEY_VISUAL_REGISTRY, resolveBeyVisualDefinition, type BeyVisualDefinition, type BeyVisualPieceSpec, type BeyVisualRegistry } from '../../presentation/beyVisual';
import type { PresentationFeatures } from '../../presentation/features';
import type { BeyDefinition } from '../archetype/BeyDefinition';
import { createConceptBeyVisual } from './conceptBeyVisual';
import { CONCEPTS } from './concepts/conceptDefinitions';
import type { ConceptDefinition } from './model/types';

/** Gameplay definition id → visual id: each of the nine selectable Beys wears its own concept (Lote 8); the family archetypes are concept A. */
export const PROVISIONAL_ARCHETYPE_VISUALS: Readonly<Record<string, string>> = Object.fromEntries(CONCEPT_BEYS.map((c) => [c.definition.id, `concept:${c.conceptId}`]));

export function conceptVisualId(concept: ConceptDefinition): string {
  return `concept:${concept.id}`;
}

function pieceSpec(concept: ConceptDefinition, piece: string): BeyVisualPieceSpec {
  return { builder: `${concept.id}/${piece}`, materials: ['concept-kit'] };
}

export function conceptVisualDefinition(concept: ConceptDefinition): BeyVisualDefinition {
  return {
    id: conceptVisualId(concept),
    label: `${concept.archetype} ${concept.letter}: ${concept.headline}`,
    status: 'concept',
    pieces: {
      topLayer: pieceSpec(concept, 'topLayer'),
      ring: pieceSpec(concept, 'ring'),
      disc: pieceSpec(concept, 'disc'),
      driver: pieceSpec(concept, 'driver'),
    },
    create: (gameplay) => createConceptBeyVisual(concept, gameplay),
  };
}

/** Registers the nine visuals and the provisional assignments. Safe to call more than once. */
export function ensureApprovedBeyVisualsRegistered(registry: BeyVisualRegistry = BEY_VISUAL_REGISTRY): void {
  for (const concept of CONCEPTS) {
    if (!registry.get(conceptVisualId(concept))) registry.register(conceptVisualDefinition(concept));
  }
  for (const [gameplayId, visualId] of Object.entries(PROVISIONAL_ARCHETYPE_VISUALS)) {
    if (registry.assignedVisualId(gameplayId) !== visualId) registry.assign(gameplayId, visualId);
  }
}

/**
 * The visual a gameplay definition wears in the game. The one resolution used
 * by both the match scene and the Character Select preview, so the Bey shown
 * on the pedestal is the Bey that fights. With `newBeyVisuals` on it registers
 * the approved concepts first (idempotent, no physics, no match needed), so it
 * works before any match has ever been created; off, it is the legacy
 * placeholder, exactly as before.
 */
export function beyVisualDefinitionFor(gameplay: BeyDefinition, features: PresentationFeatures, registry: BeyVisualRegistry = BEY_VISUAL_REGISTRY): BeyVisualDefinition {
  if (features.newBeyVisuals) ensureApprovedBeyVisualsRegistered(registry);
  return resolveBeyVisualDefinition(gameplay, features, registry);
}
