// ============================================================
// DIRECTIONAL INTENT (M11)
// Pure helpers for ControllerActions.moveIntent (the desired world
// direction of the directional control scheme), shared by movement,
// drift and dodge so they read it the same way. When an action frame has
// no moveIntent, the classic Steer/Move actions apply instead.
// ============================================================

import { Action, type ControllerActions, type MoveIntent } from '../../input/actions/Action';
import { fromYaw, signedAngleBetween } from '../../physics/Vec2';
import { DIRECTIONAL_STEERING_THRESHOLD_RAD } from './MovementTuning';

/** Below this length a moveIntent means "no direction". */
export const MOVE_INTENT_EPSILON = 1e-3;

/** 0..1: how hard the player pushes toward the intent (never above 1, so a diagonal can't be faster). */
export function intentMagnitude(intent: MoveIntent): number {
  const len = Math.sqrt(intent.x * intent.x + intent.z * intent.z);
  return len < MOVE_INTENT_EPSILON ? 0 : Math.min(1, len);
}

/** Heading change (rad, -π..π) that would face the intent: positive = increase headingRad (the SteerRight direction). */
export function headingErrorRad(intent: MoveIntent, headingRad: number): number {
  return -signedAngleBetween(fromYaw(headingRad), { x: intent.x, z: intent.z });
}

/** Whether the frame counts as steering (drift): a turn key in classic, a direction off the heading in directional. */
export function isSteering(actions: ControllerActions, headingRad: number): boolean {
  const intent = actions.moveIntent;
  if (!intent) return actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight);
  return intentMagnitude(intent) > 0 && Math.abs(headingErrorRad(intent, headingRad)) > DIRECTIONAL_STEERING_THRESHOLD_RAD;
}
