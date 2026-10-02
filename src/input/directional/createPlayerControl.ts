// ============================================================
// PLAYER CONTROL FACTORY
// The single place the player's control chain is assembled: device
// (keyboard + pad) → DirectionalController (control reference, never the
// camera — see ControlReference.ts). The real PLAY flow (MatchRunner), the
// Debug Lab and the camera/gameplay separation regression tests all build
// the player's controller through THIS function, so a test that passes
// here is exercising exactly the controller the player drives with — not a
// substitute that happens to avoid the area under test.
// ============================================================

import type { CombatController } from '../actions/Action';
import { DirectionalController, type DirectionalSources } from './DirectionalController';

export interface PlayerControlOptions extends DirectionalSources {
  /** True = the Directional scheme (the default); false = Classic (device actions pass through, Bey-relative). */
  readonly directional: boolean;
}

export function createPlayerControl(device: CombatController, options: PlayerControlOptions): DirectionalController {
  const control = new DirectionalController(device, { reference: options.reference, stick: options.stick });
  control.setEnabled(options.directional);
  return control;
}
