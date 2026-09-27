// ============================================================
// CLASH PRESENTATION LAB — DETAILED BEY VISUAL
// Wraps one of the 9 APPROVED round-2 concepts (prototypes/bey-visual-
// concepts, catalog approved in visual-prototypes-approval.md §1) in the
// same minimal { group, spinGroup } shape the game's own placeholder
// BeyVisual uses (src/bey/procedural-model/createBeyMesh.ts), so
// ClashStageSim's physics-driven position/quaternion sync and spin never
// need to know which visual is plugged in.
//
// This is a richer STAND-IN for the game's current placeholder mesh, not
// a "final Bey" decision — which 3 of the 9 concepts (one per archetype)
// ship is still explicitly open (visual-prototypes-approval.md §4.1). The
// lab lets the owner pick any of the 3 Attack concepts for the player
// side and any of the 3 Defense concepts for the opponent side, purely so
// the Clash presentation itself is reviewed with a believable Bey on
// screen instead of the crude ring/upperBody/lowerBody/tip stand-in.
// ============================================================

import * as THREE from 'three';
import { assembleConcept, type BuiltConcept } from '../../../bey-visual-concepts/src/model/assembleConcept';
import type { ConceptDefinition } from '../../../bey-visual-concepts/src/model/types';
import { BEY_COLLIDER_HALF_HEIGHT_M } from '../../../../src/bey/core/BeyTuning';
import type { BeyVisual } from '../../../../src/bey/procedural-model/createBeyMesh';

/** Widest diameter of every Bey at game scale (m) — matches the approved decision (visual-prototypes-approval.md §2.3) and the Stamina & Stability Lab's own BeyRig. */
export const BEY_DIAMETER_M = 1.3;

export interface DetailedBeyVisual extends BeyVisual {
  dispose(): void;
}

export function createDetailedBeyVisual(definition: ConceptDefinition): DetailedBeyVisual {
  const built: BuiltConcept = assembleConcept(definition);
  built.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const scale = BEY_DIAMETER_M / built.measurements.diameter;
  const scaled = new THREE.Group();
  scaled.scale.setScalar(scale);
  // The assembly's own tip contact point is at local y=0; the placeholder mesh anchors that same point at -colliderHalfHeightM below the physics body's origin (createBeyMesh.ts's own anchor rule) — matching it here keeps this drop-in visual sitting exactly where the placeholder did, never floating or clipping into the floor.
  scaled.position.y = -BEY_COLLIDER_HALF_HEIGHT_M;
  scaled.add(built.root);
  const spinGroup = new THREE.Group();
  spinGroup.add(scaled);
  const group = new THREE.Group();
  group.add(spinGroup);
  return { group, spinGroup, dispose: () => built.dispose() };
}
