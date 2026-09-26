// ============================================================
// ARENA VISUAL CONCEPTS — SHARED BUILDING BLOCKS
// ============================================================

import * as THREE from 'three';

/** Game arena scale (src/arena/colliders/ArenaTuning.ts). Visual reference only. */
export const ARENA_RADIUS = 12;

/** Deterministic RNG so every arena looks the same on every load. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bowl-shaped floor: a polar grid whose height follows `heightAt(r)`.
 * UVs are planar (top-down) so a square canvas can be painted as the
 * floor "art", with the arena center at the canvas center and the canvas
 * edge at radius `radius`.
 */
export function bowlFloor(radius: number, heightAt: (r: number) => number, rings = 64, segments = 160): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  positions.push(0, heightAt(0), 0);
  uvs.push(0.5, 0.5);
  for (let i = 1; i <= rings; i++) {
    const r = (i / rings) * radius;
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      positions.push(x, heightAt(r), z);
      uvs.push(0.5 + x / (2 * radius), 0.5 - z / (2 * radius));
    }
  }
  const ringStart = (i: number): number => 1 + (i - 1) * segments;
  for (let j = 0; j < segments; j++) indices.push(0, ringStart(1) + ((j + 1) % segments), ringStart(1) + j);
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = ringStart(i) + j;
      const b = ringStart(i) + ((j + 1) % segments);
      const c = ringStart(i + 1) + j;
      const d = ringStart(i + 1) + ((j + 1) % segments);
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Square canvas for painting floor art; (cx, cy) is the arena center and `px(r)` converts meters to pixels. */
export function floorCanvas(size = 2048): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; c: number; px: (m: number) => number } {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  return { canvas, g, c: size / 2, px: (m: number) => (m / ARENA_RADIUS) * (size / 2) };
}

export function canvasTexture(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Large inward-facing sphere with a vertical color gradient. */
export function skyDome(top: number, horizon: number, bottom: number, radius = 120): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 48, 24);
  const colors: number[] = [];
  const pos = geometry.getAttribute('position');
  const cTop = new THREE.Color(top);
  const cHor = new THREE.Color(horizon);
  const cBot = new THREE.Color(bottom);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius;
    if (y >= 0) tmp.copy(cHor).lerp(cTop, Math.pow(y, 0.6));
    else tmp.copy(cHor).lerp(cBot, Math.min(1, -y * 3));
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

/** Put an object on a circle at angle `a`, facing the center. */
export function onCircle<T extends THREE.Object3D>(object: T, radius: number, a: number, y = 0): T {
  object.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
  object.lookAt(0, y, 0);
  return object;
}

export function shadowed<T extends THREE.Mesh>(m: T, cast = true, receive = true): T {
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** Dispose every geometry / material / texture under `root`. */
export function disposeTree(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
      m.dispose();
    }
  });
  textures.forEach((t) => t.dispose());
}
