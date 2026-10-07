// Audit J3 (owner, 2026-10-03): ground effects never cut in half — every floor-hugging effect of a landing and a hit
// follows the real floor on Flat and Bowls A/B/C, at the centre, half way and near the edge.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_FLOOR_IDS, floorHeightAt, type ArenaFloorId } from '../../src/arena/floor/ArenaFloorProfile';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { createConceptBeyVisual } from '../../src/bey/visual/conceptBeyVisual';
import { CONCEPTS } from '../../src/bey/visual/concepts/conceptDefinitions';
import { HybridVfxSystem } from '../../src/vfx/hybrid/HybridVfxSystem';

function floorMeshes(scene: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    // Flat, floor-lying effects: plane geometry rotated onto XZ (no billboards, no Bey parts).
    if (m.isMesh && m.geometry instanceof THREE.PlaneGeometry && (m.material as THREE.MeshBasicMaterial).polygonOffset) out.push(m);
  });
  return out;
}

describe('J3 — ground effects follow the floor everywhere', () => {
  for (const floor of ARENA_FLOOR_IDS as readonly ArenaFloorId[]) {
    for (const r of [0, 6, 12]) {
      it(`${floor}, r = ${r} m: every vertex of every ground effect sits on the floor (within 6 cm), none under it`, () => {
        const scene = new THREE.Group();
        const camera = new THREE.PerspectiveCamera();
        const beys = { first: createConceptBeyVisual(CONCEPTS[0]!, ATTACK_ARCHETYPE), second: createConceptBeyVisual(CONCEPTS[3]!, DEFENSE_ARCHETYPE) };
        const at = (dx: number) => new THREE.Vector3(r + dx, floorHeightAt(floor, r + dx, 0) + 0.2, 0);
        beys.first.group.position.copy(at(-0.6));
        beys.second.group.position.copy(at(0.6));
        scene.add(beys.first.group, beys.second.group);
        const vfx = new HybridVfxSystem({ scene, camera, beys: { first: { visual: beys.first, gameplay: ATTACK_ARCHETYPE }, second: { visual: beys.second, gameplay: DEFENSE_ARCHETYPE } }, floorHeightAtR: (rr) => floorHeightAt(floor, rr, 0), arenaSparks: [0xffffff, 0xff0000], arenaRadiusM: 30, overlayParent: null });
        vfx.update({ dtSeconds: 1 / 60, state: null });
        const P = { x: r, y: 0.2, z: 0 };
        vfx.onEvents([
          { kind: 'landed', tick: 1, side: 'first', magnitude: 0.9, position: P, launched: true },
          { kind: 'hitResolved', tick: 1, defenderSide: 'second', attackerSide: 'first', magnitude: 1, position: P, hitboxKind: 'dash', caughtOpponentDashing: false },
        ], null as never);
        for (let i = 0; i < 6; i++) vfx.update({ dtSeconds: 1 / 30, state: null });
        const meshes = floorMeshes(scene);
        expect(meshes.length).toBeGreaterThan(3);
        const bad: string[] = [];
        const v = new THREE.Vector3();
        for (const mesh of meshes) {
          mesh.updateWorldMatrix(true, false);
          const pos = mesh.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
            const ground = floorHeightAt(floor, v.x, v.z);
            if (v.y < ground - 0.005 || v.y > ground + 0.06) bad.push(`(${v.x.toFixed(2)}, ${v.z.toFixed(2)}): ${(v.y - ground).toFixed(3)} m`);
          }
        }
        expect(bad.slice(0, 5)).toEqual([]);
        vfx.dispose();
      });
    }
  }
});
