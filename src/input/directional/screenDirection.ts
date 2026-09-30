// ============================================================
// SCREEN DIRECTION (M11 directional control, arena/world-relative)
// Pure helpers: arrows/D-pad/stick → a screen vector (x right, y up,
// length 0..1, diagonals normalized), and a screen vector → the world X/Z
// direction that goes into ControllerActions.moveIntent — a FIXED mapping
// (Up = world +Z, Right = world +X, etc.), never the camera's.
//
// This is a closed decision (playtest, 2026-09): the camera must never
// participate in the movement calculation, in any way, at any time — not
// latched, not per-gesture, not re-read on release. A camera-relative
// scheme (even one that re-reads the camera only between gestures, as an
// earlier version of this file did via CameraYawLatch) means the same key
// can produce a different world direction depending on where the camera
// happens to be pointed, which reads to a player as "the Bey goes the
// wrong way" or "I lost control" — exactly the failure mode this fixes.
// cameraYawFromRight/cameraYawOf below still exist, but ONLY for a
// diagnostic readout (F3/Debug Lab) that shows the camera's yaw next to
// the desired world vector, to prove the two are independent — nothing
// here feeds it into screenToWorld.
// ============================================================

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
 * Camera yaw (fromYaw convention: forward = (sin, cos)) from the camera's
 * world-space right vector. The right vector of a camera without roll is
 * horizontal whether it looks straight down or at the horizon, so this
 * never degenerates. DIAGNOSTIC ONLY (F3/Debug Lab) — see this file's
 * header. Never pass this into screenToWorld.
 */
export function cameraYawFromRight(rightX: number, rightZ: number): number {
  // right = (-forward.z, forward.x)  ⇒  forward = (right.z, -right.x)
  return Math.atan2(rightZ, -rightX);
}

/**
 * A screen vector as a FIXED world X/Z direction: screen up = world +Z,
 * screen right = world +X (the `fromYaw` convention: yaw 0 faces +Z). No
 * camera involved, ever — see this file's header. Holding the same key
 * always produces the same world direction, for the entire match,
 * regardless of what the camera is doing.
 */
export function screenToWorld(screen: ScreenVector): MoveIntent {
  if (screen.x === 0 && screen.y === 0) return { x: 0, z: 0 };
  return { x: quantize(screen.x), z: quantize(screen.y) };
}

function quantize(value: number): number {
  const q = Math.trunc(value / MOVE_INTENT_QUANTUM) * MOVE_INTENT_QUANTUM;
  // Trunc of a tiny negative gives -0; the replay/state hash treat it as 0, keep it a plain 0.
  return q === 0 ? 0 : Number(q.toFixed(4));
}
