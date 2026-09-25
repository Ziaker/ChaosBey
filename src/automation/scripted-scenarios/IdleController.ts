// ============================================================
// IDLE CONTROLLER — TEMPORARY MILESTONE 2 OPPONENT STAND-IN
// Never presses anything. Real AI is Milestone 7 (GDD section 62-64) —
// this exists only so Milestone 2's two-Bey combat has a second body to
// hit/test against in the meantime. Clearly temporary, not a design
// decision about AI behavior.
// ============================================================

import type { Action } from '../../input/actions/Action';
import type { CombatController, ControllerActions, ControllerContext } from '../../input/actions/Action';

const EMPTY_SET: ReadonlySet<Action> = new Set();

export class IdleController implements CombatController {
  sampleActions(_context: ControllerContext): ControllerActions {
    return {
      held: EMPTY_SET,
      pressedThisFrame: EMPTY_SET,
      attackHoldDurationSeconds: 0,
      jumpDriftHoldDurationSeconds: 0,
    };
  }
}
