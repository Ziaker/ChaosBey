// ============================================================
// SCREEN DIRECTION (M11 directional control — now an experimental/debug
// option, not the player default; see fix 9/"Fix 6" below)
// Pure helpers: arrows/D-pad/stick → a screen vector (x right, y up,
// length 0..1, diagonals normalized), and a screen vector → the world X/Z
// direction that goes into ControllerActions.moveIntent — a FIXED mapping
// (Up = world +Z, Right = world +X, etc.), never the camera's.
//
// This module has no camera dependency at all — not even for diagnostics.
// The debug overlay/inspector reads the camera's own yaw directly from
// MatchSession.getLastCameraOutput().yawDeg, never through src/input/. An
// architectural regression-guard test asserts src/input/ never imports
// from src/camera/.
//
// History: a camera-relative scheme (even one that re-reads the camera
// only between gestures, as an earlier version of this file did via
// CameraYawLatch) meant the same key could produce a different world
// direction depending on where the camera happened to be pointed, which
// read to a player as "the Bey goes the wrong way" or "I lost control".
// Fixing that by making the world mapping fixed and camera-free removed
// that failure mode. But with the camera itself now free to orbit widely
// (the fix 8 two-fighter director), a FIXED arena mapping has its own
// failure mode: when the camera turns 90/180/270°, "up" on screen no
// longer lines up with world +Z, so a constant, unchanging key can *look*
// wrong on screen even though the Bey's world trajectory never changed —
// this is a screen-reading problem, not a control coupling. The owner's
// decision (2026-09-30, "Fix 6" of this playtest round): the player
// DEFAULT is no longer this arena/world-relative scheme. It is now
// Bey-relative/kart-like (Classic, see PlayerSettings.ts and
// MovementController's no-moveIntent path) — a scheme with no absolute
// axis to fall out of alignment with the screen in the first place. This
// module and its arena-relative mapping are kept as a selectable,
// non-default option (still fully camera-independent, just not what a
// player gets without changing Settings).
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
