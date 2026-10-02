// ============================================================
// SCENE STATS
// A read-only census of a Three.js subtree, so the future visual passes can
// compare object, geometry, material and triangle counts before and after
// each integration. Measures only; it sets no thresholds (there is no baseline
// yet to set them from) and changes nothing it counts. Draw calls, FPS and
// frame time already exist in the Debug Lab's renderer stats; this adds what
// the renderer cannot say about one subtree.
// ============================================================

import * as THREE from 'three';

export interface SceneStats {
  readonly objects: number;
  readonly visibleObjects: number;
  readonly meshes: number;
  readonly points: number;
  readonly lines: number;
  readonly sprites: number;
  readonly geometries: number;
  readonly materials: number;
  /** Triangles of visible meshes (indexed or not). */
  readonly triangles: number;
  /** Total particle count across visible Points objects. */
  readonly particles: number;
}

export function collectSceneStats(root: THREE.Object3D): SceneStats {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  let objects = 0;
  let visibleObjects = 0;
  let meshes = 0;
  let points = 0;
  let lines = 0;
  let sprites = 0;
  let triangles = 0;
  let particles = 0;

  root.traverse((object) => {
    objects++;
    const visible = isEffectivelyVisible(object);
    if (visible) visibleObjects++;
    const renderable = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    if (renderable.geometry) geometries.add(renderable.geometry);
    if (renderable.material) {
      for (const material of Array.isArray(renderable.material) ? renderable.material : [renderable.material]) materials.add(material);
    }
    const geometry = renderable.geometry;
    if (object instanceof THREE.Mesh) {
      meshes++;
      if (visible && geometry) triangles += geometry.index ? geometry.index.count / 3 : (geometry.getAttribute('position')?.count ?? 0) / 3;
    } else if (object instanceof THREE.Points) {
      points++;
      if (visible && geometry) particles += geometry.getAttribute('position')?.count ?? 0;
    } else if (object instanceof THREE.Line) {
      lines++;
    } else if (object instanceof THREE.Sprite) {
      sprites++;
    }
  });

  return { objects, visibleObjects, meshes, points, lines, sprites, geometries: geometries.size, materials: materials.size, triangles: Math.round(triangles), particles };
}

function isEffectivelyVisible(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}
