// ============================================================
// BEY FLOW FX LAB — ANIME DUST TEXTURES
// One texture per dust idea, all drawn from the owner's reference sheets
// (2026-10-08): white cel shapes with a cool grey/violet shade and a thin
// ink outline.
//
//   rollCloud   a rolling dust wave: lumpy crest on a flat base, tapering to a
//               torn tail with a couple of detached slivers (idea 1)
//   bubble      a hand-drawn round puff: ink outline, violet shade, highlight (idea 2)
//   shard       a curved white blade, pointed at both ends (idea 3)
//
// The shapes are plain functions of unit coordinates (so the tests can check
// them without a canvas); the canvas drawing sits on top. Textures are
// cached per page and never disposed (tiny, shared by every effect).
// ============================================================

import * as THREE from 'three';

export interface Blob {
  x: number;
  y: number;
  r: number;
}

export type Point = readonly [number, number];

export const INK = '#3b3f8c';
export const SHADE = '#8f86ff';
export const GREY_SHADE = '#c3cad6';
export const ROLL_VARIANTS = 3;
export const ROLL_BASE_Y = 0.74;

/** Deterministic 0..1 hash so every variant is the same on every run. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The lumps of a rolling wave: x, y in unit coordinates of the 2:1 tile (y down; the head is on the left, the tail on
 * the right), r as a fraction of the tile's HEIGHT. They sit on the flat base line and shrink toward the tail, so the crest tapers.
 */
export function rollLumps(variant: number): Blob[] {
  const v = variant * 13;
  const count = 7;
  const lumps: Blob[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const r = 0.23 * Math.pow(1 - t, 0.75) * (0.85 + hash(v + i) * 0.3) + 0.04;
    lumps.push({ x: 0.2 + t * 0.52, y: ROLL_BASE_Y - r * 0.92, r });
  }
  // A taller curled lump at the head, like the crest of a wave about to fall.
  lumps.push({ x: 0.16, y: ROLL_BASE_Y - 0.3, r: 0.17 + hash(v + 40) * 0.03 });
  return lumps;
}

/** The torn tail: a thin tapered strip along the base from the last lump to the right edge. */
export function rollTail(): Point[] {
  return [
    [0.7, ROLL_BASE_Y - 0.1],
    [0.84, ROLL_BASE_Y - 0.06],
    [0.97, ROLL_BASE_Y - 0.015],
    [0.98, ROLL_BASE_Y],
    [0.7, ROLL_BASE_Y],
  ];
}

/** A few small round bubbles of a hand-drawn cluster (unit offsets from the cluster centre, and relative size). */
export function bubbleCluster(variant: number, count: number): Blob[] {
  const v = variant * 19;
  const out: Blob[] = [];
  for (let i = 0; i < count; i++) {
    const a = hash(v + i) * Math.PI * 2;
    const d = i === 0 ? 0 : 0.35 + hash(v + i + 9) * 0.45;
    out.push({ x: Math.cos(a) * d, y: Math.abs(Math.sin(a)) * d * 0.7 - (i === 0 ? 0 : 0.05), r: i === 0 ? 1 : 0.5 + hash(v + i + 21) * 0.35 });
  }
  return out;
}

/** The blade: two curves between two pointed tips (unit coordinates, y down), a leaf bent a little. */
export const SHARD = {
  tipA: [0.03, 0.56] as Point,
  tipB: [0.97, 0.44] as Point,
  upperControl: [0.5, 0.08] as Point,
  lowerControl: [0.5, 0.78] as Point,
};

function quad(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
}

/** Upper edge A→B and lower edge B→A, sampled. They meet at the tips. */
export function shardPoints(steps = 20): { upper: Point[]; lower: Point[] } {
  const upper: Point[] = [];
  const lower: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    upper.push(quad(SHARD.tipA, SHARD.upperControl, SHARD.tipB, t));
    lower.push(quad(SHARD.tipB, SHARD.lowerControl, SHARD.tipA, t));
  }
  return { upper, lower };
}

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, width: number, height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') {
    // No DOM (unit tests under Node): an undrawn stand-in of the same type.
    const stub = new THREE.CanvasTexture({ width: 1, height: 1 } as unknown as HTMLCanvasElement);
    cache.set(key, stub);
    return stub;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!, width, height);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Rolling dust wave, 2:1, head on the left. */
export const rollCloud = (variant = 0): THREE.CanvasTexture =>
  make(`rollCloud${variant % ROLL_VARIANTS}`, 512, 256, (g, w, h) => {
    const lumps = rollLumps(variant % ROLL_VARIANTS);
    const tail = rollTail();
    const body = (dx: number, dy: number, grow: number): void => {
      for (const b of lumps) {
        g.beginPath();
        g.arc((b.x + dx) * w, (b.y + dy) * h, b.r * h * grow, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      tail.forEach(([x, y], i) => (i === 0 ? g.moveTo((x + dx) * w, (y + dy) * h) : g.lineTo((x + dx) * w, (y + dy) * h)));
      g.closePath();
      g.fill();
    };
    // Flat base: nothing below the base line.
    g.save();
    g.beginPath();
    g.rect(0, 0, w, ROLL_BASE_Y * h + 1);
    g.clip();
    g.fillStyle = INK;
    body(0.004, 0.012, 1.08);          // ink outline
    g.fillStyle = GREY_SHADE;
    body(0.004, 0.012, 1);             // shade silhouette
    g.fillStyle = '#ffffff';
    body(-0.006, -0.012, 0.9);         // lit white, nudged up-left
    g.restore();
    // Two detached slivers above the tail, like the streaks in the reference.
    g.fillStyle = '#ffffff';
    g.strokeStyle = INK;
    g.lineWidth = 2;
    for (const [x0, y0, len] of [[0.62, 0.34, 0.26], [0.7, 0.46, 0.22]] as const) {
      g.beginPath();
      g.moveTo(x0 * w, y0 * h);
      g.quadraticCurveTo((x0 + len * 0.5) * w, (y0 - 0.03) * h, (x0 + len) * w, (y0 + 0.01) * h);
      g.quadraticCurveTo((x0 + len * 0.5) * w, (y0 + 0.02) * h, x0 * w, y0 * h);
      g.fill();
      g.stroke();
    }
  });

/** Hand-drawn round puff: white, ink outline, violet shade on the lower right, a small highlight. */
export const bubble = (): THREE.CanvasTexture =>
  make('bubble', 256, 256, (g, s) => {
    const c = s / 2;
    const r = s * 0.44;
    // Violet disc, then the lit white part (shifted up-left) over it: what is left of the violet is the shade.
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.fillStyle = SHADE;
    g.fill();
    g.save();
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.clip();
    g.beginPath();
    g.arc(c - r * 0.18, c - r * 0.2, r * 0.92, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.restore();
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.strokeStyle = INK;
    g.lineWidth = s * 0.018;
    g.stroke();
    g.beginPath();
    g.ellipse(c - r * 0.42, c - r * 0.5, r * 0.16, r * 0.1, -0.6, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = s * 0.008;
    g.stroke();
  });

/** Curved white blade, pointed at both ends: white body, violet shade along the lower edge, ink outline. */
export const shard = (): THREE.CanvasTexture =>
  make('shard', 512, 256, (g, w, h) => {
    const { upper, lower } = shardPoints(24);
    const path = (): void => {
      g.beginPath();
      upper.forEach(([x, y], i) => (i === 0 ? g.moveTo(x * w, y * h) : g.lineTo(x * w, y * h)));
      lower.forEach(([x, y]) => g.lineTo(x * w, y * h));
      g.closePath();
    };
    path();
    g.fillStyle = '#ffffff';
    g.fill();
    g.save();
    path();
    g.clip();
    g.strokeStyle = SHADE;
    g.lineWidth = h * 0.16;
    g.lineJoin = 'round';
    g.beginPath();
    lower.forEach(([x, y], i) => (i === 0 ? g.moveTo(x * w, y * h) : g.lineTo(x * w, y * h)));
    g.stroke();
    g.restore();
    path();
    g.strokeStyle = INK;
    g.lineWidth = h * 0.022;
    g.lineJoin = 'round';
    g.stroke();
  });
