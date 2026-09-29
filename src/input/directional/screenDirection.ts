// ============================================================
// SCREEN DIRECTION (M11 directional control)
// Pure helpers: arrows/D-pad/stick → a screen vector (x right, y up,
// length 0..1, diagonals normalized), and a screen vector + camera yaw →
// the world X/Z direction that goes into ControllerActions.moveIntent.
// The camera only ever reaches the input layer as a yaw number; the
// simulation never sees it.
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
 * never degenerates.
 */
export function cameraYawFromRight(rightX: number, rightZ: number): number {
  // right = (-forward.z, forward.x)  ⇒  forward = (right.z, -right.x)
  return Math.atan2(rightZ, -rightX);
}

/** A screen vector as a world X/Z direction for a camera with this yaw: screen up = camera forward on the ground. */
export function screenToWorld(screen: ScreenVector, cameraYawRad: number): MoveIntent {
  if (screen.x === 0 && screen.y === 0) return { x: 0, z: 0 };
  const fx = Math.sin(cameraYawRad);
  const fz = Math.cos(cameraYawRad);
  // right = (-fz, fx)
  const x = fx * screen.y - fz * screen.x;
  const z = fz * screen.y + fx * screen.x;
  return { x: quantize(x), z: quantize(z) };
}

function quantize(value: number): number {
  const q = Math.trunc(value / MOVE_INTENT_QUANTUM) * MOVE_INTENT_QUANTUM;
  // Trunc of a tiny negative gives -0; the replay/state hash treat it as 0, keep it a plain 0.
  return q === 0 ? 0 : Number(q.toFixed(4));
}

/** Screen angle change (rad) that counts as a new gesture and re-reads the camera. */
export const GESTURE_CHANGE_RAD = Math.PI / 6;

/**
 * Latches the camera yaw for the duration of one input gesture (a held
 * direction). While the player keeps holding the same direction, the
 * world direction stays put even if the automatic camera turns — so the
 * camera following the Bey can never feed back into the command and send
 * it orbiting. Releasing the direction, or turning it by more than
 * GESTURE_CHANGE_RAD, re-reads the camera.
 */
export class CameraYawLatch {
  private latchedYaw: number | null = null;
  private latchedScreenAngle = 0;

  resolve(screen: ScreenVector, currentCameraYaw: number): MoveIntent {
    if (screenLength(screen) === 0) {
      this.latchedYaw = null;
      return { x: 0, z: 0 };
    }
    const angle = Math.atan2(screen.x, screen.y);
    if (this.latchedYaw === null || Math.abs(wrapAngle(angle - this.latchedScreenAngle)) > GESTURE_CHANGE_RAD) {
      this.latchedYaw = currentCameraYaw;
      this.latchedScreenAngle = angle;
    }
    return screenToWorld(screen, this.latchedYaw);
  }

  reset(): void {
    this.latchedYaw = null;
  }
}

export function wrapAngle(rad: number): number {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}
