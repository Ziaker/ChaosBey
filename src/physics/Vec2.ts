// ============================================================
// VEC2 — HORIZONTAL-PLANE VECTOR MATH
// Small, narrow math helper for the X/Z ground-plane vectors that
// movement/spin/drift all need (heading, velocity, slip angle). Kept
// physics-domain and renderer-independent — no THREE import here — so
// these components stay usable without pulling in Three.js.
// ============================================================

export interface Vec2 {
  x: number;
  z: number;
}

export function vec2(x: number, z: number): Vec2 {
  return { x, z };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, z: a.z * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

export function length(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.z * a.z);
}

/** Direction (unit vector) from a yaw angle, using the convention x = sin(yaw), z = cos(yaw) — yaw 0 faces +Z. */
export function fromYaw(yawRad: number): Vec2 {
  return { x: Math.sin(yawRad), z: Math.cos(yawRad) };
}

/** Signed angle (radians) from `a` to `b`, positive = clockwise looking down the Y axis, matching fromYaw's convention. */
export function signedAngleBetween(a: Vec2, b: Vec2): number {
  const cross = a.x * b.z - a.z * b.x;
  const d = dot(a, b);
  return Math.atan2(cross, d);
}
