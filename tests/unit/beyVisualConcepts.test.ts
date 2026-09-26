import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { CONCEPTS } from '../../prototypes/bey-visual-concepts/src/concepts/conceptDefinitions';
import { assembleConcept, type BuiltConcept } from '../../prototypes/bey-visual-concepts/src/model/assembleConcept';

// Visual-prototype sanity checks (not gameplay). The owner's success
// criterion is "nine black silhouettes side by side must still be
// distinguishable", so besides basic validity this rasterizes each
// concept's top and side silhouettes and requires every pair to differ.

const GRID = 72;
const EXTENT = 3.6; // half-size of the raster window, same units as the models

const built = new Map<string, BuiltConcept>(CONCEPTS.map((c) => [c.id, assembleConcept(c)]));

afterAll(() => built.forEach((b) => b.dispose()));

type Plane = 'top' | 'side';

function silhouette(concept: BuiltConcept, plane: Plane): Uint8Array {
  const mask = new Uint8Array(GRID * GRID);
  const cell = (2 * EXTENT) / GRID;
  const toGrid = (v: THREE.Vector3): [number, number] =>
    plane === 'top' ? [(v.x + EXTENT) / cell, (v.z + EXTENT) / cell] : [(v.x + EXTENT) / cell, v.y / cell + 1];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  concept.root.updateMatrixWorld(true);
  concept.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const pos = object.geometry.getAttribute('position');
    const index = object.geometry.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const [i0, i1, i2] = index ? [index.getX(3 * t), index.getX(3 * t + 1), index.getX(3 * t + 2)] : [3 * t, 3 * t + 1, 3 * t + 2];
      const p0 = toGrid(a.fromBufferAttribute(pos, i0).applyMatrix4(object.matrixWorld));
      const p1 = toGrid(b.fromBufferAttribute(pos, i1).applyMatrix4(object.matrixWorld));
      const p2 = toGrid(c.fromBufferAttribute(pos, i2).applyMatrix4(object.matrixWorld));
      const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
      const maxX = Math.min(GRID - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
      const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
      const maxY = Math.min(GRID - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
      const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((p1[0] - px) * (p2[1] - py) - (p2[0] - px) * (p1[1] - py)) / area;
          const w1 = ((p2[0] - px) * (p0[1] - py) - (p0[0] - px) * (p2[1] - py)) / area;
          if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) mask[y * GRID + x] = 1;
        }
      }
    }
  });
  return mask;
}

function iou(m1: Uint8Array, m2: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < m1.length; i++) {
    if (m1[i] && m2[i]) inter++;
    if (m1[i] || m2[i]) union++;
  }
  return union === 0 ? 1 : inter / union;
}

describe('Bey visual concepts prototype', () => {
  it('defines exactly three concepts per archetype with unique ids', () => {
    expect(CONCEPTS).toHaveLength(9);
    expect(new Set(CONCEPTS.map((c) => c.id)).size).toBe(9);
    for (const archetype of ['attack', 'defense', 'stamina'] as const) {
      expect(CONCEPTS.filter((c) => c.archetype === archetype).map((c) => c.letter)).toEqual(['A', 'B', 'C']);
    }
  });

  it.each(CONCEPTS.map((c) => c.id))('%s builds finite geometry standing on its tip with a clearly visible tip', (id) => {
    const concept = built.get(id)!;
    const box = new THREE.Box3().setFromObject(concept.root);
    expect(Number.isFinite(box.min.x + box.max.x + box.min.y + box.max.y)).toBe(true);
    expect(box.min.y).toBeGreaterThan(-0.05); // nothing sinks meaningfully through the floor
    expect(box.min.y).toBeLessThan(0.05); // and the tip touches it
    const m = concept.measurements;
    expect(m.diameter).toBeGreaterThan(3.5);
    expect(m.tipLength / m.height).toBeGreaterThanOrEqual(0.25); // "pontas relativamente longas"
    let meshes = 0;
    concept.root.traverse((o) => { if (o instanceof THREE.Mesh) meshes++; });
    expect(meshes).toBeGreaterThanOrEqual(10); // not a two-primitive toy
  });

  it('every pair of concepts has a clearly different top or side silhouette', () => {
    const masks = CONCEPTS.map((c) => ({ id: c.id, top: silhouette(built.get(c.id)!, 'top'), side: silhouette(built.get(c.id)!, 'side') }));
    const tooSimilar: string[] = [];
    for (let i = 0; i < masks.length; i++) {
      for (let j = i + 1; j < masks.length; j++) {
        const difference = Math.max(1 - iou(masks[i]!.top, masks[j]!.top), 1 - iou(masks[i]!.side, masks[j]!.side));
        if (difference < 0.2) tooSimilar.push(`${masks[i]!.id} vs ${masks[j]!.id}: ${difference.toFixed(2)}`);
      }
    }
    expect(tooSimilar).toEqual([]);
  });
});
