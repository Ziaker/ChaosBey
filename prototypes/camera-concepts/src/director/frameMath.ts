// ============================================================
// CAMERA LAB — SMALL VECTOR + FRAMING MATH
// Plain {x,y,z} math (no Three.js), so the director runs and is tested
// headless. `inFrame` is the one readability check both the director's
// off-screen rescue and the unit tests use.
// ============================================================

import type { Vec3 } from '../fight/FightFrame';

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const set3 = (o: Vec3, x: number, y: number, z: number): Vec3 => {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
};
export const copy3 = (o: Vec3, a: Vec3): Vec3 => set3(o, a.x, a.y, a.z);
export const lerp3 = (o: Vec3, a: Vec3, b: Vec3, t: number): Vec3 => set3(o, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const distXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const finite3 = (a: Vec3): boolean => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

/** 1 - e^(-rate·dt): frame-rate-independent smoothing factor. */
export const smoothK = (ratePerS: number, dt: number): number => 1 - Math.exp(-Math.max(0, ratePerS) * dt);

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Shortest signed angle from `a` to `b` (radians). */
export const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDelta(a, b) * t;
/** Yaw of an XZ direction, matching the game's convention (yaw 0 → +Z, sin/cos). */
export const yawOf = (x: number, z: number): number => Math.atan2(x, z);

/**
 * Is `point` inside the view of a camera at `eye` looking at `focus`?
 * `margin` shrinks the frame (0.1 = keep 10% away from the edges).
 */
export function inFrame(point: Vec3, eye: Vec3, focus: Vec3, fovDeg: number, aspect: number, margin = 0): boolean {
  let fx = focus.x - eye.x;
  let fy = focus.y - eye.y;
  let fz = focus.z - eye.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × up(0,1,0)
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  // up' = right × forward
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  const depth = dx * fx + dy * fy + dz * fz;
  if (depth <= 0.2) return false;
  const sx = (dx * rx + dz * rz) / depth;
  const sy = (dx * ux + dy * uy + dz * uz) / depth;
  const tanV = Math.tan((fovDeg * Math.PI) / 360) * (1 - margin);
  return Math.abs(sy) <= tanV && Math.abs(sx) <= tanV * aspect;
}
