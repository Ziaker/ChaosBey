// ============================================================
// CONTROL SCHEME → CONTROLLER SETUP (composition layer)
// Maps the player's chosen ControlScheme to how the player's
// DirectionalController is configured: Classic passes the device through
// (Bey-relative), the others resolve the arrows in a ControlReference.
//
// CAMERA RULE (owner requirement, 2026-10-01): the camera never moves the
// Bey. Three of the four schemes are camera-free — they read gameplay state
// only (positions of the Beys) or nothing at all.
//
// THE ONE EXCEPTION: the opt-in 'screen' scheme reads the presentation
// camera's yaw, ONCE when a gesture starts, because the owner explicitly
// asked for a screen-relative option. It is never the default, it is the
// only place in the codebase where camera output reaches input, and the
// architectural guard (tests/unit/inputCameraBoundary.test.ts) allowlists
// exactly this file for that reason. Do not read the camera anywhere else.
// ============================================================

import type { MatchSession, Side } from '../session/MatchSession';
import type { ControlScheme } from '../../config/settings/PlayerSettings';
import { createLatchedReference, createOpponentReference, WORLD_CONTROL_REFERENCE, type ControlReference } from '../../input/directional/ControlReference';

export interface ControlSetup {
  /** False = Classic (device actions pass through; Bey-relative). */
  readonly directional: boolean;
  readonly reference: ControlReference;
}

export interface ControlSetupContext {
  /** Read lazily: the controller is built before the session exists. */
  readonly session: () => MatchSession | null;
  /** The side the human drives (default 'first'). */
  readonly playerSide?: Side;
}

export function controlSetupFor(scheme: ControlScheme, ctx: ControlSetupContext): ControlSetup {
  const side: Side = ctx.playerSide ?? 'first';
  switch (scheme) {
    case 'classic':
      return { directional: false, reference: WORLD_CONTROL_REFERENCE };
    case 'arena':
      return { directional: true, reference: WORLD_CONTROL_REFERENCE };
    case 'opponent':
      return {
        directional: true,
        reference: createOpponentReference(() => {
          const session = ctx.session();
          if (!session) return null;
          const from = session.getBey(side).body.translation();
          const to = session.getBey(side === 'first' ? 'second' : 'first').body.translation();
          return { from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z } };
        }),
      };
    case 'screen':
      // OPT-IN EXCEPTION: reads the camera. Up = away from the camera (camera yaw + 180°), read once per gesture.
      return {
        directional: true,
        reference: createLatchedReference(() => (((ctx.session()?.getLastCameraOutput()?.yawDeg ?? 0) + 180) * Math.PI) / 180),
      };
  }
}
