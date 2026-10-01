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
  yawRad(gestureActive: boolean): number;
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

/** Reads `read()` once when a gesture starts and keeps that value until every direction is released. */
export function createLatchedReference(read: () => number): ControlReference {
  let latched: number | null = null;
  return {
    kind: 'latched',
    yawRad: (gestureActive) => {
      if (!gestureActive) {
        latched = null;
        return 0;
      }
      latched ??= read();
      return latched;
    },
  };
}
