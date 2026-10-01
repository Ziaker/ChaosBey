// ============================================================
// SCREEN DIRECTION (M11 directional control — the player default again,
// "Fix 7" of this playtest round, 2026-10-01, superseding "Fix 6")
// Pure helpers: arrows/D-pad/stick → a screen vector (x right, y up,
// length 0..1, diagonals normalized), and a screen vector + the camera's
// current yaw → the world X/Z direction that goes into
// ControllerActions.moveIntent — screen up = away from the camera, screen
// right = the camera's right, on the ground plane, recomputed fresh every
// single tick. Up always looks like "away" on screen, right always looks
// like "right" on screen, no matter where the camera currently is.
//
// History, in order:
// 1. The original scheme (camera-relative, but LATCHED to the camera's
//    yaw at the start of each input gesture — CameraYawLatch) meant the
//    same held key could silently change its world meaning mid-hold, the
//    moment the automatic camera crossed a latch boundary: "eu perco
//    controle", "vai pra direção errada" (owner playtest). Fixed by
//    removing the camera dependency entirely ("Fix 5"/2451e8d): a FIXED
//    world mapping (Up = world +Z always), proven camera-independent by
//    construction.
// 2. That fixed mapping is indeed camera-independent, but with the camera
//    itself free to orbit widely (the fix 8 two-fighter director), a
//    constant, unchanging key can still *look* wrong on screen once the
//    camera has turned 90/180/270° — a screen-reading problem, not a
//    control-coupling bug. "Fix 6" (2026-09-30) replaced the player
//    default with Bey-relative/kart-like steering (Classic) specifically
//    to have no world axis to fall out of alignment with the screen.
// 3. Verified in a real browser against the real two-fighter camera
//    (2026-10-01): Classic doesn't actually fix the perceptual problem
//    either, because this camera isn't a chase cam — it frames both
//    fighters, so it can end up on any side of the player's own heading.
//    Holding a single key the entire time, the dot product between the
//    Bey's actual velocity and the camera's forward view flipped sign
//    repeatedly (+0.93, -0.17, -0.84, +0.26, -0.26, +0.85, …): the SAME
//    held key alternates between "moving away" and "moving toward the
//    camera" on screen, with nothing the player did causing the flip.
//    This is mathematically unavoidable for ANY mapping that doesn't read
//    the camera, given a camera that isn't fixed to the world OR to the
//    player's heading. The owner's decision (2026-10-01, "Fix 7"):
//    reinstate camera-relative mapping as the default — the industry's
//    standard answer to exactly this problem (Zelda, Dark Souls, God of
//    War) — but WITHOUT the gesture latch that caused failure 1: this
//    version re-reads the camera's actual current yaw on every tick, with
//    no latching, no gesture boundaries and no stale state at all. A
//    continuously-held key that keeps meaning "away from the camera" as
//    the camera itself slowly orbits is the camera genuinely being read
//    on purpose now, by design — the point is for the Bey's trajectory to
//    bend smoothly with the camera so the screen always reads right, not
//    for the input layer to be blind to the camera as "Fix 5"/"Fix 6"
//    tried. Classic (Bey-relative, no camera at all) stays selectable for
//    a player who prefers it.
// 4. "Fix 9" (owner playtest, same day): "a câmera move o bey sozinho —
//    só o jogador move o jogador". Re-reading the yaw on every tick meant
//    the automatic camera orbiting under a held key steered the Bey with
//    nobody touching the controls. The camera is now read once, when the
//    player starts to move, and frozen until every direction is released
//    (DirectionalController.gestureYaw): the screen still reads right at
//    the moment of input, but from then on only the player moves the Bey.
//    No mid-hold re-read boundary, so failure 1 above cannot recur.
// ============================================================

import { fromYaw, perpendicular, scale, type Vec2 } from '../../physics/Vec2';
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
 * Yaw (fromYaw convention: x = sin, z = cos) of a camera, from its
 * world-space right axis (the 1st column of its world matrix). The right
 * vector of a camera without roll is horizontal whether it looks down or
 * at the horizon, so this never degenerates — unlike reading the forward
 * axis, which flattens to zero length looking straight down.
 */
export function cameraYawFromRight(rightX: number, rightZ: number): number {
  // right = (cos(yaw), -sin(yaw))  ⇒  yaw = atan2(-rightZ, rightX)
  return Math.atan2(-rightZ, rightX);
}

/**
 * A screen vector as a world X/Z direction for a camera at this yaw:
 * screen up = straight away from the camera (on the ground plane), screen
 * right = the camera's right. No latch, no memory — purely a function of
 * the screen vector and the yaw passed in this call, recomputed fresh on
 * every tick by the caller.
 */
export function screenToWorld(screen: ScreenVector, cameraYawRad: number): MoveIntent {
  if (screen.x === 0 && screen.y === 0) return { x: 0, z: 0 };
  const away: Vec2 = scale(fromYaw(cameraYawRad), -1); // away from the camera, on the ground
  const right: Vec2 = perpendicular(fromYaw(cameraYawRad)); // the camera's right, on the ground
  const x = away.x * screen.y + right.x * screen.x;
  const z = away.z * screen.y + right.z * screen.x;
  return { x: quantize(x), z: quantize(z) };
}

function quantize(value: number): number {
  const q = Math.trunc(value / MOVE_INTENT_QUANTUM) * MOVE_INTENT_QUANTUM;
  // Trunc of a tiny negative gives -0; the replay/state hash treat it as 0, keep it a plain 0.
  return q === 0 ? 0 : Number(q.toFixed(4));
}
