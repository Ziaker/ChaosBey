// ============================================================
// CONTROL REFERENCE — which way "up" on the arrows means
// (owner requirement, 2026-10-01: "A CÂMERA NUNCA MOVE O BEY")
//
// The Directional control schemes turn an arrow/stick direction into a
// world X/Z direction. They need a frame of reference to do that. By
// default that frame is owned by INPUT/GAMEPLAY and is never the
// presentation camera:
//
//   Camera is downstream presentation. It may observe gameplay; it may
//   never mutate or causally influence gameplay.
//
// This file holds the camera-free references:
//   - WORLD_CONTROL_REFERENCE      fixed arena frame (up = −Z, right = +X)
//   - createOpponentReference()    up = toward the opponent (gameplay state)
//   - createLatchedReference()     generic "read a yaw once per gesture"
//                                  wrapper (used ONLY by the opt-in screen
//                                  scheme, see app/frontend/
//                                  controlReferences.ts)
// Bey-relative steering is not a reference at all: it is the Classic
// scheme (DirectionalController disabled).
//
// src/input/ may not mention the camera (tests/unit/inputCameraBoundary
// .test.ts). The opt-in 'screen' scheme, which DOES read the camera on the
// owner's explicit exception, is wired entirely outside src/input/.
// ============================================================

/** Frame of reference for the Directional schemes. `yawRad` uses fromYaw's convention (x = sin, z = cos): "up" maps to fromYaw(yawRad). */
export interface ControlReference {
  readonly kind: 'world' | 'opponent' | 'latched';
  /**
   * The yaw "up" maps to. Called once per tick. `gestureActive` is true
   * while any direction is held, so a reference may keep one value for the
   * whole gesture.
   */
  yawRad(gestureActive: boolean, screen?: { readonly x: number; readonly y: number }): number;
}

/** The fixed arena frame: up = world −Z (away from the default viewpoint), right = +X. Constant for the whole match. */
export const WORLD_CONTROL_REFERENCE: ControlReference = {
  kind: 'world',
  yawRad: () => Math.PI,
};

export interface BearingEnds {
  readonly from: { readonly x: number; readonly z: number };
  readonly to: { readonly x: number; readonly z: number };
}

/**
 * Up = toward the opponent, recomputed from gameplay state every tick
 * (positions only — never presentation). When the two are on top of each
 * other (no bearing) the last bearing is kept, so the controls never snap.
 */
export function createOpponentReference(ends: () => BearingEnds | null): ControlReference {
  let lastYaw = Math.PI;
  return {
    kind: 'opponent',
    yawRad: () => {
      const e = ends();
      if (e) {
        const dx = e.to.x - e.from.x;
        const dz = e.to.z - e.from.z;
        if (dx * dx + dz * dz > 1e-6) lastYaw = Math.atan2(dx, dz);
      }
      return lastYaw;
    },
  };
}

/**
 * Reads `read()` when a gesture starts and keeps it steady while directions stay held — but (owner, 2026-10-04: "o
 * controle às vezes perde o próprio controle dependendo do ângulo da câmera … quando se bate numa parede e quando o
 * jogo começa com a câmera atrás do oponente") it is no longer frozen for the whole gesture:
 * - a new direction (the held direction turns by more than 30°) re-reads it at once, so a new arrow always means
 *   the screen as it is now;
 * - while the same direction stays held, it follows a camera that really turns, at most FOLLOW_RATE (≈ 90°/s), so a
 *   quick shake or wobble never jerks the controls but a camera that swings round (after a wall hit, at the start
 *   of a match) no longer leaves the arrows pointing the old way.
 */
export function createLatchedReference(read: () => number): ControlReference {
  let latched: number | null = null;
  let lastDirection: number | null = null;
  return {
    kind: 'latched',
    yawRad: (gestureActive, screen) => {
      if (!gestureActive) {
        latched = null;
        lastDirection = null;
        return 0;
      }
      const direction = screen && (screen.x !== 0 || screen.y !== 0) ? Math.atan2(screen.x, screen.y) : null;
      const turned = direction !== null && lastDirection !== null && Math.abs(Math.atan2(Math.sin(direction - lastDirection), Math.cos(direction - lastDirection))) > NEW_DIRECTION_RAD;
      if (direction !== null) lastDirection = direction;
      if (latched === null || turned) {
        latched = read();
        return latched;
      }
      const target = read();
      const diff = Math.atan2(Math.sin(target - latched), Math.cos(target - latched));
      latched += Math.max(-FOLLOW_STEP_RAD, Math.min(FOLLOW_STEP_RAD, diff));
      return latched;
    },
  };
}

/** A held direction turning by more than this is a new direction: the reference is re-read at once. */
const NEW_DIRECTION_RAD = Math.PI / 6;
/** How fast a held direction follows a turning camera (rad per 60 Hz tick ≈ 1.57 rad/s ≈ 90°/s). PROVISIONAL. */
const FOLLOW_STEP_RAD = (Math.PI / 2) / 60;
