// Ported from prototypes/arena-visual-concepts/src/arenas/common.ts (Arena Visual Concepts, approved 2026-09-26/27; docs/design-decisions/visual-prototypes-approval.md §2).
// Adapted only where marked "GAME:" (the floor profile comes from the real arena floor, no DOM in Node). Presentation only: nothing here reaches a collider.
// ============================================================
// ARENA VISUAL CONCEPTS — SHARED BUILDING BLOCKS
// ============================================================

import * as THREE from 'three';
import { ARENA_FLOOR_RADIUS } from '../colliders/ArenaTuning';

/** The lab's arena radius (m): the approved art was authored on a 12 m floor. Floor markings are still painted in these units. */
export const LAB_ARENA_RADIUS = 12;
/**
 * GAME: the real floor radius (src/arena/colliders/ArenaTuning.ts; 36 m since the 0.12.0 scale pass). Read, never written.
 * The art follows the scale pass's own rule: the horizontal footprint grows by ARENA_SCALE, sizes of things (wall height,
 * panels, posts, rocks, seats) stay in real metres and repeated elements get more copies at the same spacing; the light
 * rigs, sky and haze are scaled as a whole so the floor is lit and fogged the way the lab lit its 12 m floor.
 */
export const ARENA_RADIUS = ARENA_FLOOR_RADIUS;
/** GAME: horizontal factor from the lab's 12 m floor to the real one. */
export const ARENA_SCALE = ARENA_RADIUS / LAB_ARENA_RADIUS;

/** GAME: how many copies of a repeated element (wall panel, post, rock, polygon segment) keep the lab's spacing on the real floor. */
export function scaledCount(labCount: number): number {
  return Math.max(labCount, Math.round(labCount * ARENA_SCALE));
}

/**
 * GAME: a light scaled with its rig keeps the same illuminance on the floor when its distance grows by `ARENA_SCALE`:
 * the falloff is distance^decay, so the intensity grows by ARENA_SCALE^decay.
 */
export function rigIntensity(labIntensity: number, decay: number): number {
  return labIntensity * Math.pow(ARENA_SCALE, decay);
}

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
  // GAME: `px` takes the lab's metres (the canvas edge is the lab's 12 m rim); the floor's planar UVs stretch the painting over the real floor.
  // GAME: without a DOM (unit tests under Node) paint on a no-op context so the arena still builds. Not in the lab.
  const canvas = typeof document === 'undefined' ? (stubCanvas() as unknown as HTMLCanvasElement) : document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  return { canvas, g, c: size / 2, px: (m: number) => (m / LAB_ARENA_RADIUS) * (size / 2) };
}

export function canvasTexture(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Large inward-facing sphere with a vertical color gradient. */
export function skyDome(top: number, horizon: number, bottom: number, radius = 120 * ARENA_SCALE): THREE.Mesh {
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

/** A canvas whose 2D context accepts every call and draws nothing (Node only). */
function stubCanvas(): { width: number; height: number; getContext: () => CanvasRenderingContext2D } {
  const handler: ProxyHandler<object> = {
    get(target, prop) {
      if (prop === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (prop === 'canvas') return canvasLike;
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      return () => new Proxy({ addColorStop: () => undefined }, handler);
    },
    set(target, prop, value) {
      (target as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  };
  const context = new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
  const canvasLike = { width: 0, height: 0, getContext: () => context };
  return canvasLike;
}
