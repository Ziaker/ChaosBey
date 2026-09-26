// ============================================================
// BEY VISUAL CONCEPTS — ASSEMBLY
// Builds one concept's five parts and stacks them bottom-up:
//
//   y = 0 ............ tip contact point (touches the floor)
//   tip.height ....... lowerBody base
//   + lowerBody ...... middleLayer base   <- upperRing mounted here
//   + middleLayer .... core base
//
// Each part is wrapped in a named group (`tip`, `lowerBody`, …) so it is
// easy to find in the scene graph when inspecting / remixing.
// ============================================================

import * as THREE from 'three';
import { createMaterialKit } from './materials';
import type { ConceptDefinition, ConceptParts } from './types';

export interface ConceptMeasurements {
  /** Widest top-view extent (units are arbitrary prototype units, ~cm). */
  readonly diameter: number;
  readonly height: number;
  /** Length of the tip part alone. */
  readonly tipLength: number;
  /** Tip + lower body: everything under the chassis/ring. */
  readonly underbodyLength: number;
}

export interface BuiltConcept {
  readonly root: THREE.Group;
  readonly measurements: ConceptMeasurements;
  dispose(): void;
}

const PART_ORDER: ReadonlyArray<keyof ConceptParts> = ['tip', 'lowerBody', 'middleLayer', 'upperRing', 'core'];

export function assembleConcept(definition: ConceptDefinition): BuiltConcept {
  const mats = createMaterialKit(definition.palette);
  const ctx = { mats };
  const built = Object.fromEntries(PART_ORDER.map((slot) => [slot, definition.parts[slot](ctx)])) as Record<keyof ConceptParts, ReturnType<ConceptParts['tip']>>;

  const tipTop = built.tip.height;
  const middleBase = tipTop + built.lowerBody.height;
  const middleTop = middleBase + built.middleLayer.height;
  const mountY: Record<keyof ConceptParts, number> = {
    tip: 0,
    lowerBody: tipTop,
    middleLayer: middleBase,
    upperRing: middleBase,
    core: middleTop,
  };

  const root = new THREE.Group();
  root.name = `concept:${definition.id}`;
  for (const slot of PART_ORDER) {
    const holder = new THREE.Group();
    holder.name = slot;
    holder.position.y = mountY[slot];
    holder.add(built[slot].object);
    root.add(holder);
  }

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  let maxRadius = 0;
  const v = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      maxRadius = Math.max(maxRadius, Math.hypot(v.x, v.z));
    }
  });

  return {
    root,
    measurements: {
      diameter: maxRadius * 2,
      height: box.max.y - Math.min(0, box.min.y),
      tipLength: built.tip.height,
      underbodyLength: middleBase,
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) geometries.add(object.geometry);
      });
      geometries.forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
  };
}
