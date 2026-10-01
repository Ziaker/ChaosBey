// ============================================================
// CONCEPT BEY VISUAL — the approved four-piece Bey as a BeyVisual
// Wraps the ported concept builders (Top Layer, Ring, Disc, Driver) into the
// two-group shape the match scene already drives: `group` carries the physics
// pose, tilt and wobble; `spinGroup` carries the visual spin about the
// vertical axis. Presentation only: nothing here reaches the collider, the
// mass or the stats, and the camera is not involved.
//
// Placement rules (visual-prototypes-approval.md section 1):
//   - the concept is authored with its tip contact point at y = 0; here that
//     point sits at the bottom of THIS Bey's own collider
//     (`colliderHalfHeightM`), the same rule the placeholder mesh follows, so a
//     taller or shorter collider never floats or digs into the floor;
//   - prototype units become metres at CONCEPT_BEY_SCALE, the scale the Arena,
//     VFX and Condition labs use for the same models.
// ============================================================

import * as THREE from 'three';
import type { BeyDefinition } from '../archetype/BeyDefinition';
import type { BeyVisual } from '../procedural-model/createBeyMesh';
import { assembleConcept } from './model/assembleConcept';
import type { ConceptDefinition } from './model/types';

/** Prototype units to metres: the labs' BEY_SCALE (a ~6-unit ring becomes a ~1.4 m Bey). */
export const CONCEPT_BEY_SCALE = 0.24;

export function createConceptBeyVisual(concept: ConceptDefinition, gameplay: BeyDefinition): BeyVisual {
  const built = assembleConcept(concept);
  const group = new THREE.Group();
  const spinGroup = new THREE.Group();
  group.add(spinGroup);
  built.root.scale.setScalar(CONCEPT_BEY_SCALE);
  built.root.position.y = -gameplay.physical.colliderHalfHeightM;
  spinGroup.add(built.root);
  return { group, spinGroup };
}
