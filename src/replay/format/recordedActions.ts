// ============================================================
// RECORDED ACTIONS (M9 lane B)
// Lossless, JSON-safe form of one side's ControllerActions for one tick,
// and back. Sets become sorted arrays so equal inputs serialize to equal
// bytes; hold durations are kept as the exact numbers the controller
// produced (JSON round-trips every finite double exactly).
//
// `pressed` is NOT required to be a subset of `held`: a UI action
// (Pause, DebugToggle, SettingsToggle) can be flushed as pressed with
// nothing held (ActionSampleBuffer), and a replay must reproduce exactly
// what the controller returned.
// ============================================================

import { Action, type ControllerActions } from '../../input/actions/Action';
import type { RecordedActions } from '../contracts';

const ACTION_VALUES: ReadonlySet<string> = new Set(Object.values(Action));

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && ACTION_VALUES.has(value);
}

export function toRecordedActions(actions: ControllerActions): RecordedActions {
  return {
    held: [...actions.held].sort(),
    pressed: [...actions.pressedThisFrame].sort(),
    attackHoldS: actions.attackHoldDurationSeconds,
    jumpDriftHoldS: actions.jumpDriftHoldDurationSeconds,
  };
}

export function fromRecordedActions(recorded: RecordedActions): ControllerActions {
  return {
    held: new Set(recorded.held),
    pressedThisFrame: new Set(recorded.pressed),
    attackHoldDurationSeconds: recorded.attackHoldS,
    jumpDriftHoldDurationSeconds: recorded.jumpDriftHoldS,
  };
}
