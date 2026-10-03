// ============================================================
// FLOOR EFFECTS LIE ON THE REAL FLOOR (owner, 2026-10-02: "ground waves saindo pela metade")
// A flat quad placed at the floor height of its centre was buried on the bowl
// (the floor rises outward). Conformed quads put every vertex on the floor.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_FLOORS } from '../../src/arena/floor/ArenaFloorProfile';
import { flatFx } from '../../src/vfx/hybrid/fx/primitives';

const LIFT = 0.04;

function worldVertices(object: THREE.Object3D): THREE.Vector3[] {
  object.updateMatrixWorld(true);
  const mesh = object as THREE.Mesh;
  const pos = mesh.geometry.getAttribute('position');
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld));
  return out;
}

describe('flat floor effects conform to the floor', () => {
  for (const floor of ['bowl-a', 'bowl-b', 'bowl-c'] as const) {
    const h = ARENA_FLOORS[floor].heightAtRadius;
    it.each([0, 15, 30])(`${floor}: a 7 m ground wave centred at r = %s m sits ${LIFT} m above the floor at every vertex`, (r) => {
      const centre = new THREE.Vector3(r * 0.6, h(r) + LIFT, r * 0.8);
      const fx = flatFx({ tex: new THREE.Texture(), color: 0xffffff, pos: centre, size: [0.4, 7], life: 0.5, rotation: 0.7, conform: { floorHeightAt: h, lift: LIFT } });
      for (const k of [0.2, 0.6, 1]) {
        fx.update(k, 1 / 60, fx as never);
        for (const v of worldVertices(fx.object)) expect(v.y - h(Math.hypot(v.x, v.z))).toBeCloseTo(LIFT, 4);
      }
    });
  }

  it('without conform it stays the lab\'s flat quad (and on the bowl that buried the outer half: why conform exists)', () => {
    const h = ARENA_FLOORS['bowl-a'].heightAtRadius;
    const r = 30;
    const fx = flatFx({ tex: new THREE.Texture(), color: 0xffffff, pos: new THREE.Vector3(r, h(r) + LIFT, 0), size: [0.4, 7], life: 0.5 });
    fx.update(1, 1 / 60, fx as never);
    const buried = worldVertices(fx.object).filter((v) => v.y < h(Math.hypot(v.x, v.z)));
    expect(buried.length).toBeGreaterThan(0);
  });
});
