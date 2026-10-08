// ============================================================
// BEY FLOW FX LAB — ANIME TEXTURES
// Two shapes taken from the owner's reference sheets (2026-10-08):
//
//   toonCloud   white cumulus with a light-grey lower shade and a flat base
//               (the "cartoon smoke" silhouettes), in three variants
//   crescent    a curved wind blade: white body, violet inner shade, thin
//               ink outline, pointed tips (the swirling bands of the last sheet)
//
// The shapes themselves are plain functions of unit coordinates (so the
// tests can check them without a canvas); the canvas drawing sits on top.
// Textures are cached per page and never disposed (tiny, shared).
// The approved Cel Cyclone textures (jaggedRing, tornStreak) are reused
// from src/vfx/hybrid/fx/textures.ts, not redrawn here.
// ============================================================

import * as THREE from 'three';

export interface Blob {
  x: number;
  y: number;
  r: number;
}

export type Point = readonly [number, number];

export const CLOUD_VARIANTS = 3;

/** Deterministic 0..1 hash so every variant is the same on every run. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A cumulus in unit coordinates (0..1, y down): a row of fat blobs along a flat base,
 * a narrower row above, and a few bumps on top. Pure and deterministic per `variant`.
 */
export function cloudBlobs(variant: number): Blob[] {
  const blobs: Blob[] = [];
  const v = variant * 17;
  const baseCount = 5;
  for (let i = 0; i < baseCount; i++) {
    const t = i / (baseCount - 1);
    blobs.push({ x: 0.2 + t * 0.6, y: 0.68 + (hash(v + i) - 0.5) * 0.04, r: 0.13 + hash(v + i + 10) * 0.05 });
  }
  const midCount = 3 + (variant % 2);
  for (let i = 0; i < midCount; i++) {
    const t = (i + 0.5) / midCount;
    blobs.push({ x: 0.26 + t * 0.48, y: 0.5 + (hash(v + i + 20) - 0.5) * 0.06, r: 0.15 + hash(v + i + 30) * 0.06 });
  }
  const topCount = 2;
  for (let i = 0; i < topCount; i++) {
    blobs.push({ x: 0.36 + i * 0.26 + (hash(v + i + 40) - 0.5) * 0.08, y: 0.33 + hash(v + i + 50) * 0.05, r: 0.12 + hash(v + i + 60) * 0.05 });
  }
  return blobs;
}

/** Quadratic Bezier sample. */
function quad(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
}

/** The crescent's two edges as quadratic curves (unit coordinates, y down). */
export const CRESCENT = {
  tipA: [0.04, 0.7] as Point,
  tipB: [0.96, 0.52] as Point,
  outerControl: [0.5, -0.18] as Point,
  innerControl: [0.5, 0.46] as Point,
};

/** Outer edge A→B and inner edge B→A, sampled. The two meet at the pointed tips. */
export function crescentPoints(steps = 24): { outer: Point[]; inner: Point[] } {
  const outer: Point[] = [];
  const inner: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    outer.push(quad(CRESCENT.tipA, CRESCENT.outerControl, CRESCENT.tipB, t));
    inner.push(quad(CRESCENT.tipB, CRESCENT.innerControl, CRESCENT.tipA, t));
  }
  return { outer, inner };
}

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') {
    // No DOM (unit tests under Node): an undrawn stand-in of the same type.
    const stub = new THREE.CanvasTexture({ width: 1, height: 1 } as unknown as HTMLCanvasElement);
    cache.set(key, stub);
    return stub;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** White cartoon cumulus with a light-grey shade on the lower right and a flat base. */
export const toonCloud = (variant = 0): THREE.CanvasTexture =>
  make(`toonCloud${variant % CLOUD_VARIANTS}`, 256, (g, s) => {
    const blobs = cloudBlobs(variant % CLOUD_VARIANTS);
    // Flat base: nothing below this line.
    g.save();
    g.beginPath();
    g.rect(0, 0, s, s * 0.84);
    g.clip();
    const layer = (color: string, dx: number, dy: number, grow: number): void => {
      g.fillStyle = color;
      for (const b of blobs) {
        g.beginPath();
        g.arc((b.x + dx) * s, (b.y + dy) * s, b.r * s * grow, 0, Math.PI * 2);
        g.fill();
      }
    };
    layer('#5b6478', 0.012, 0.014, 1.07);    // thin ink outline (white on the light stadium would vanish)
    layer('#c3cad6', 0.012, 0.014, 1);       // shade silhouette
    layer('#ffffff', -0.016, -0.02, 0.9);     // lit white, nudged up-left
    g.restore();
  });

/** Curved wind blade: white body, violet inner shade, thin ink outline. */
export const crescent = (): THREE.CanvasTexture =>
  make('crescent', 512, (g, s) => {
    const { outer, inner } = crescentPoints(32);
    const path = (): void => {
      g.beginPath();
      outer.forEach(([x, y], i) => (i === 0 ? g.moveTo(x * s, y * s) : g.lineTo(x * s, y * s)));
      inner.forEach(([x, y]) => g.lineTo(x * s, y * s));
      g.closePath();
    };
    path();
    g.fillStyle = '#ffffff';
    g.fill();
    // Violet shade hugging the inner edge.
    g.save();
    path();
    g.clip();
    g.strokeStyle = '#8f86ff';
    g.lineWidth = s * 0.085;
    g.lineJoin = 'round';
    g.beginPath();
    inner.forEach(([x, y], i) => (i === 0 ? g.moveTo(x * s, y * s) : g.lineTo(x * s, y * s)));
    g.stroke();
    g.restore();
    // Ink outline.
    path();
    g.strokeStyle = '#3b3f8c';
    g.lineWidth = s * 0.012;
    g.lineJoin = 'round';
    g.stroke();
  });
