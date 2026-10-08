// ============================================================
// BEY FLOW FX LAB — DUST TEXTURES
// Canvas textures for the anime dust, drawn by fx/dustArt.ts from the owner's
// reference sheets. Each texture carries flat cel colours (white and a soft
// grey) and an EROSION alpha: 0 at the edge rising to 1 a little way inside,
// so an alpha test that creeps up eats the shape from its edge (thin tails and
// spikes first) instead of fading it like a sticker.
// Cached per page and never disposed (a handful of small canvases, shared).
// ============================================================

import * as THREE from 'three';
import { DUST_SIZES, DUST_VARIANTS, ERODE_REACH, applyErosionAlpha, drawDust, type DustKind } from './dustArt';

const cache = new Map<string, THREE.CanvasTexture>();

/** The texture of one dust shape (`variant` wraps at DUST_VARIANTS). */
export function dustTexture(kind: DustKind, variant: number): THREE.CanvasTexture {
  const v = ((variant % DUST_VARIANTS) + DUST_VARIANTS) % DUST_VARIANTS;
  const key = `${kind}${v}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') {
    // No DOM (unit tests under Node): an undrawn stand-in of the same type.
    const stub = new THREE.CanvasTexture({ width: 1, height: 1 } as unknown as HTMLCanvasElement);
    cache.set(key, stub);
    return stub;
  }
  const { w, h } = DUST_SIZES[kind];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  drawDust(g, kind, v);
  applyErosionAlpha(g, w, h, ERODE_REACH * w);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}
