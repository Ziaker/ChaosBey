// ============================================================
// CREATE BEY MESH — VISUAL/PHYSICAL ANCHOR CONSISTENCY (Milestone 6 review 3)
// createBeyMesh() used to anchor the driver tip at the fixed
// BEY_COLLIDER_HALF_HEIGHT_M constant regardless of which archetype it was
// building for, so Attack (colliderHalfHeightM 0.18) visually dug slightly
// into the floor and Defense/Stamina (0.27/0.24) floated slightly above
// it. Each BeyDefinition's appearance now threads its own
// physical.colliderHalfHeightM through — this proves the visual
// assembly's lowest point actually matches it, for every archetype.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BEY_DEFINITION, type BeyDefinition } from '../../src/bey/archetype/BeyDefinition';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';

describe('createBeyMesh anchor matches each archetype\'s own physical collider half-height', () => {
  const cases: Array<[string, BeyDefinition]> = [
    ['default', DEFAULT_BEY_DEFINITION],
    ['attack', ATTACK_ARCHETYPE],
    ['defense', DEFENSE_ARCHETYPE],
    ['stamina', STAMINA_ARCHETYPE],
  ];

  for (const [label, definition] of cases) {
    it(`${label}: the visual assembly's lowest point (driver tip) is at -physical.colliderHalfHeightM, not the global default`, () => {
      const visual = definition.appearance.createVisual();
      const box = new THREE.Box3().setFromObject(visual.spinGroup);

      expect(box.min.y).toBeCloseTo(-definition.physical.colliderHalfHeightM, 2);
    });
  }

  it('regression: Attack/Defense/Stamina do NOT anchor at the shared default half-height (0.2), since their own profiles differ from it', () => {
    for (const definition of [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE]) {
      expect(definition.physical.colliderHalfHeightM).not.toBe(DEFAULT_BEY_DEFINITION.physical.colliderHalfHeightM);
      const visual = definition.appearance.createVisual();
      const box = new THREE.Box3().setFromObject(visual.spinGroup);
      expect(box.min.y).not.toBeCloseTo(-DEFAULT_BEY_DEFINITION.physical.colliderHalfHeightM, 2);
    }
  });
});
