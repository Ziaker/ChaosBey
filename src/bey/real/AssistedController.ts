// ============================================================
// BEY REAL — THE ASSISTED CONTROLLER
// Wraps whoever drives a side (the keyboard / pad, or the AI) in a Bey Real match: the wrapped controller keeps deciding the
// four actions (Attack, Jump, Dodge — and what the AI does with them). Nobody steers the Bey: the stage's physics moves it
// (RealMotion). The only thing a person adds is a lean — the stick, × `influence` — that RealMotion turns into a force capped by
// the tip's grip. The AI side has no stick: its Bey goes where the bowl and the tip take it (0.64.0, owner 2026-10-10: no more
// autopilot picking an orbit and chasing the opponent).
//
// What the wrapper writes is an ordinary ControllerActions with a `moveIntent`, so the movement, the Dodge's direction, the
// recorder and the replay need to know nothing about it: a replay plays the recorded lean back as it is.
// The classic left/right/forward/back keys are cleared — nothing else may turn them into a Drift or a tank turn.
// ============================================================

import { Action, type CombatController, type ControllerActions, type ControllerContext } from '../../input/actions/Action';
import type { Vec2 } from '../../physics/Vec2';
import type { RealModeConfig } from './RealTuning';

const STEERING_KEYS: readonly Action[] = [Action.SteerLeft, Action.SteerRight, Action.MoveForward, Action.MoveBackward];

/** The lean the player's stick gives: the stick (length capped at 1) × influence. No stick, or influence 0 = no lean. */
export function leanOf(stick: Vec2 | undefined, influence: number): Vec2 {
  if (!stick) return { x: 0, z: 0 };
  const length = Math.hypot(stick.x, stick.z);
  if (length < 1e-6) return { x: 0, z: 0 };
  const w = Math.min(1, Math.max(0, influence)) * Math.min(1, length);
  return { x: (stick.x / length) * w, z: (stick.z / length) * w };
}

export class AssistedController implements CombatController {
  constructor(
    private readonly inner: CombatController,
    private readonly config: RealModeConfig,
    /** True for the side a person plays: its stick leans the top by `influence`. The AI side never leans. */
    private readonly hasStick: boolean,
  ) {}

  sampleActions(context: ControllerContext): ControllerActions {
    const actions = this.inner.sampleActions(context);
    const moveIntent = this.hasStick ? leanOf(actions.moveIntent, this.config.influence) : { x: 0, z: 0 };
    const held = new Set(actions.held);
    for (const key of STEERING_KEYS) held.delete(key);
    return { ...actions, held, moveIntent };
  }
}
