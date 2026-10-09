// 0.62.0: the approved Bey models are merged to one draw call per material per piece. The look must not change: the same
// triangles in the same places, the same material instances, the same bounds, the same named pieces.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { assembleConcept, PIECE_ORDER } from '../../src/bey/visual/model/assembleConcept';
import { mergeStaticMeshes } from '../../src/presentation/mergeStaticMeshes';
import { CONCEPTS } from '../../src/bey/visual/concepts/conceptDefinitions';

function stats(root: THREE.Object3D): { meshes: number; triangles: number; materials: Set<THREE.Material>; box: THREE.Box3; vertexSum: number } {
  root.updateMatrixWorld(true);
  let meshes = 0;
  let triangles = 0;
  let vertexSum = 0;
  const materials = new Set<THREE.Material>();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    triangles += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
    materials.add(m.material as THREE.Material);
    // Summed per triangle corner (through the index), so an indexed and a flattened geometry of the same surface agree.
    const p = g.getAttribute('position');
    const corners = g.index ? g.index.count : p.count;
    for (let c = 0; c < corners; c++) {
      v.fromBufferAttribute(p, g.index ? g.index.getX(c) : c).applyMatrix4(m.matrixWorld);
      vertexSum += v.x + 2 * v.y + 3 * v.z;
    }
  });
  return { meshes, triangles, materials, box: new THREE.Box3().setFromObject(root), vertexSum };
}

describe('merged Bey models', () => {
  for (const concept of CONCEPTS) {
    it(`${concept.id}: far fewer draw calls, the same model`, () => {
      const plain = assembleConcept(concept, { mergeMeshes: false });
      const merged = assembleConcept(concept);
      const a = stats(plain.root);
      const b = stats(merged.root);
      expect(b.meshes).toBeLessThan(a.meshes * 0.8);
      expect(b.triangles).toBe(a.triangles);
      // The same set of materials (by their own colours/settings), and the exact same vertices in the same places.
      expect(b.materials.size).toBe(a.materials.size);
      expect(Math.abs(b.vertexSum - a.vertexSum) / Math.abs(a.vertexSum)).toBeLessThan(1e-6);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(b.box.min[axis]).toBeCloseTo(a.box.min[axis], 5);
        expect(b.box.max[axis]).toBeCloseTo(a.box.max[axis], 5);
      }
      expect(merged.measurements.diameter).toBeCloseTo(plain.measurements.diameter, 5);
      expect(merged.measurements.height).toBeCloseTo(plain.measurements.height, 5);
      for (const name of PIECE_ORDER) expect(merged.root.getObjectByName(name), name).toBeDefined();
      plain.dispose();
      merged.dispose();
    });
  }

  it('the pieces still move as wholes (the exploded view)', () => {
    const built = assembleConcept(CONCEPTS[0]!);
    const before = new THREE.Box3().setFromObject(built.root).getSize(new THREE.Vector3()).y;
    built.setExplode(1);
    built.root.updateMatrixWorld(true);
    const after = new THREE.Box3().setFromObject(built.root).getSize(new THREE.Vector3()).y;
    expect(after).toBeGreaterThan(before);
    built.dispose();
  });

  it('leaves mirrored, hidden, instanced and multi-material meshes alone, and merging twice changes nothing', () => {
    const holder = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    const box = () => new THREE.BoxGeometry(1, 1, 1);
    const a = new THREE.Mesh(box(), material);
    const b = new THREE.Mesh(box(), material);
    b.position.x = 2;
    const mirrored = new THREE.Mesh(box(), material);
    mirrored.scale.x = -1;
    const hidden = new THREE.Mesh(box(), material);
    hidden.visible = false;
    const instanced = new THREE.InstancedMesh(box(), material, 3);
    const multi = new THREE.Mesh(box(), [material, material]);
    holder.add(a, b, mirrored, hidden, instanced, multi);
    const report = mergeStaticMeshes(holder);
    expect(report.meshesBefore).toBe(6);
    expect(report.meshesAfter).toBe(5); // a + b merged into one
    expect(mergeStaticMeshes(holder).meshesAfter).toBe(5);
    expect(holder.children).toContain(mirrored);
    expect(holder.children).toContain(hidden);
    expect(holder.children).toContain(instanced);
  });
});
