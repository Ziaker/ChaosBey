// ============================================================
// SCREEN DIRECTION (M11 directional control)
// Pure helpers: arrows/D-pad/stick → a screen vector (x right, y up,
// length 0..1, diagonals normalized), and a screen vector + a control
// reference yaw → the world X/Z direction that goes into
// ControllerActions.moveIntent.
//
// The reference yaw comes from a ControlReference (ControlReference.ts):
// a gameplay/input-owned frame, NEVER the presentation camera. Owner
// requirement, 2026-10-01: the camera never moves the Bey, directly or
// indirectly. Camera is downstream presentation: it may observe gameplay;
// it may never mutate or causally influence gameplay.
//
// History (so nobody re-derives a camera dependency from it):
// - An early scheme read the camera's yaw (latched per gesture, then
//   fresh every tick, then latched again — "Fix 7", "Fix 9"). Every
//   variant kept the camera in the causal chain of the Bey's movement, so
//   the automatic camera orbiting could change where the Bey went. That is
//   a violation of the rule above, not a tuning problem, and all of it was
//   removed (docs/design-decisions/camera-gameplay-separation.md).
// - Now the reference is a ControlReference with several owner-selectable
//   implementations (ControlReference.ts / app/frontend/controlReferences.ts).
//   NOTE: the earlier arena-fixed mapping (up +Z, right +X) was a MIRROR
//   image (right was the left-hand side of up); right is now always the
//   clockwise quarter-turn of up, as on a screen.
// ============================================================

import { fromYaw, type Vec2 } from '../../physics/Vec2';
import type { MoveIntent } from '../actions/Action';

/** Screen-space direction: +x right, +y up, length 0..1. */
export interface ScreenVector {
  readonly x: number;
  readonly y: number;
}

export const ZERO_SCREEN: ScreenVector = { x: 0, y: 0 };

/** Radial deadzone for the analog stick (directional mode reads the stick continuously). */
export const DIRECTIONAL_STICK_DEADZONE = 0.2;

/** Resolution of a recorded intent component (keeps replays compact; truncation never lengthens a vector past 1). */
export const MOVE_INTENT_QUANTUM = 1e-4;

/** Digital directions (arrows, D-pad): diagonals are normalized, opposite keys cancel. */
export function screenVectorFromDigital(up: boolean, down: boolean, left: boolean, right: boolean): ScreenVector {
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (up ? 1 : 0) - (down ? 1 : 0);
  if (x === 0 && y === 0) return ZERO_SCREEN;
  const len = Math.sqrt(x * x + y * y);
  return { x: x / len, y: y / len };
}

/**
 * Analog stick (gamepad axes: +x right, +y DOWN) with a radial deadzone;
 * the magnitude is rescaled so it starts at 0 just past the deadzone and
 * reaches 1 at full tilt, never above.
 */
export function screenVectorFromStick(axisX: number, axisY: number, deadzone = DIRECTIONAL_STICK_DEADZONE): ScreenVector {
  const len = Math.sqrt(axisX * axisX + axisY * axisY);
  if (!(len > deadzone)) return ZERO_SCREEN;
  const magnitude = Math.min(1, (len - deadzone) / (1 - deadzone));
  return { x: (axisX / len) * magnitude, y: (-axisY / len) * magnitude };
}

export function screenLength(v: ScreenVector): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * A direction vector (x right, y up) as a world X/Z direction in a control
 * reference with this yaw: "up" = fromYaw(referenceYawRad); "right" = up
 * turned a quarter-turn CLOCKWISE seen from above (a right-handed frame,
 * like a screen: up −Z ⇒ right +X). A pure function of its two arguments —
 * no latch, no memory, and no camera: the yaw is the gameplay
 * ControlReference's.
 */
export function screenToWorld(screen: ScreenVector, referenceYawRad: number): MoveIntent {
  if (screen.x === 0 && screen.y === 0) return { x: 0, z: 0 };
  const up: Vec2 = fromYaw(referenceYawRad);
  const right: Vec2 = { x: -up.z, z: up.x }; // NOT perpendicular(up): that one is the mirror image (left of up)
  const x = up.x * screen.y + right.x * screen.x;
  const z = up.z * screen.y + right.z * screen.x;
  return { x: quantize(x), z: quantize(z) };
}

function quantize(value: number): number {
  const q = Math.trunc(value / MOVE_INTENT_QUANTUM) * MOVE_INTENT_QUANTUM;
  // Trunc of a tiny negative gives -0; the replay/state hash treat it as 0, keep it a plain 0.
  return q === 0 ? 0 : Number(q.toFixed(4));
}
