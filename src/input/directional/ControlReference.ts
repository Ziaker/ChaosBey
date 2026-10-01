// ============================================================
// CONTROL REFERENCE — which way "up" on the arrows means
// (owner requirement, 2026-10-01: "A CÂMERA NUNCA MOVE O BEY")
//
// The Directional control scheme turns an arrow/stick direction into a
// world X/Z direction. It needs a frame of reference to do that, and that
// frame is owned by INPUT/GAMEPLAY — never by the presentation camera:
//
//   Camera is downstream presentation. It may observe gameplay; it may
//   never mutate or causally influence gameplay.
//
// A ControlReference is therefore a gameplay-side object: a pure function
// of nothing (WORLD_CONTROL_REFERENCE) or, in a future variant, of
// gameplay state (e.g. the Bey's own heading). It is NOT constructed from,
// and cannot be handed, a camera number: the type below has no parameter
// to receive one, and src/input/ may not mention the camera at all
// (tests/unit/inputCameraBoundary.test.ts). If the camera needs to frame
// the action differently, the camera moves — the reference does not.
//
// PENDING OWNER DECISION (docs/design-decisions/camera-gameplay-separation.md):
// which reference the player default uses. Today it is the fixed arena
// ("world") reference — the mapping the owner previously had in "Fix 5".
// A Bey-relative reference is the other camera-free candidate (Classic
// already steers Bey-relative). This file is the single plug point for
// either; the invariant above is not up for decision.
// ============================================================

/** Frame of reference for the Directional scheme. `yawRad` uses fromYaw's convention (x = sin, z = cos): screen-up maps to fromYaw(yawRad). */
export interface ControlReference {
  readonly kind: 'world';
  /** The yaw (radians) that screen-up maps to. Gameplay-owned; must never be derived from the camera. */
  yawRad(): number;
}

/** The fixed arena frame: up = world +Z, right = world +X. Constant for the whole match. */
export const WORLD_CONTROL_REFERENCE: ControlReference = {
  kind: 'world',
  yawRad: () => 0,
};
