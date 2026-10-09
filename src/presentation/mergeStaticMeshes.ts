// ============================================================
// MERGE STATIC MESHES — one draw call per material per piece (0.62.0)
// An approved Bey is built from dozens of small meshes (teeth, bolts, fins, studs, windows, grooves…), each its own draw call
// — about a hundred per Bey, two Beys in every frame, plus the shadow pass. The pieces never move relative to their holder
// (only whole holders move, for the exploded view), so every mesh of one material inside a holder is baked into a single
// geometry. The look is identical (same material instances, same vertices in the holder's frame, same bounds); only the draw
// calls change. Anything that is not plainly static opaque geometry is left exactly as it is.
// ============================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface MergeReport {
  readonly meshesBefore: number;
  readonly meshesAfter: number;
}

function countMeshes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

function mergeable(mesh: THREE.Mesh): boolean {
  const m = mesh as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
  if (m.isInstancedMesh || m.isSkinnedMesh) return false;
  if (Array.isArray(mesh.material) || !mesh.visible || mesh.children.length > 0) return false;
  const g = mesh.geometry;
  // (Groups are ignored: a single-material mesh draws its whole geometry, which is what the merge keeps.)
  if (Object.keys(g.morphAttributes).length > 0) return false;
  return !!g.getAttribute('position');
}

function sameLayout(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  const ka = Object.keys(a.attributes).sort();
  const kb = Object.keys(b.attributes).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => a.getAttribute(k).itemSize === b.getAttribute(k).itemSize && a.getAttribute(k).normalized === b.getAttribute(k).normalized);
}

/** Merges the static meshes under `holder` by material (and shadow flags), in the holder's own frame. Returns the draw-call saving. */
export function mergeStaticMeshes(holder: THREE.Object3D): MergeReport {
  const meshesBefore = countMeshes(holder);
  holder.updateWorldMatrix(true, true);
  const toLocal = new THREE.Matrix4().copy(holder.matrixWorld).invert();

  const groups = new Map<string, THREE.Mesh[]>();
  holder.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mergeable(mesh)) return;
    const relative = new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld);
    if (relative.determinant() <= 0) return; // a mirrored mesh draws with flipped winding: leave it
    const material = mesh.material as THREE.Material;
    const key = `${material.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${mesh.renderOrder}|${mesh.frustumCulled ? 1 : 0}`;
    const list = groups.get(key);
    if (list) list.push(mesh);
    else groups.set(key, [mesh]);
  });

  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0]!;
    if (!meshes.every((m) => sameLayout(first.geometry, m.geometry))) continue;
    // Indexed and non-indexed geometries cannot be merged together: flatten them all when they differ.
    const indexedCount = meshes.filter((m) => m.geometry.index !== null).length;
    const flatten = indexedCount !== 0 && indexedCount !== meshes.length;
    // The box the parts gave (each part's own box moved into the holder's frame): kept as the merged mesh's box, so the anchors
    // and framing that are derived from `Box3.setFromObject` stay exactly where they were.
    const looseBox = new THREE.Box3();
    const baked = meshes.map((m) => {
      const relative = new THREE.Matrix4().multiplyMatrices(toLocal, m.matrixWorld);
      if (m.geometry.boundingBox === null) m.geometry.computeBoundingBox();
      looseBox.union(m.geometry.boundingBox!.clone().applyMatrix4(relative));
      let g = m.geometry.clone();
      if (flatten && g.index) g = g.toNonIndexed();
      return g.applyMatrix4(relative);
    });
    const merged = mergeGeometries(baked, false);
    for (const g of baked) g.dispose();
    if (!merged) continue;
    merged.boundingBox = looseBox;
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = first.name ? `${first.name}+${meshes.length - 1}` : 'merged';
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.frustumCulled = first.frustumCulled;
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    holder.add(mesh);
  }
  return { meshesBefore, meshesAfter: countMeshes(holder) };
}
