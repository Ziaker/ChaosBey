// ============================================================
// BEY REAL — THE ASSISTED CONTROLLER
// Wraps whoever drives a side (the keyboard / pad, or the AI) in a Bey Real match: the wrapped controller keeps deciding the
// four actions (Attack, Jump, Dodge — and what the AI does with them), while the steering is the autopilot's, with the
// player's stick mixed in by `influence` (RealAutopilot.blendSteering). The AI side has no stick: it is the autopilot alone.
//
// What the wrapper writes is an ordinary ControllerActions with a `moveIntent`, so the movement, the Dodge's direction, the
// recorder and the replay need to know nothing about it: a replay plays the recorded blend back as it is.
// The classic left/right/forward/back keys are cleared — nothing else may turn them into a Drift or a tank turn.
// ============================================================

import type { Bey } from '../core/Bey';
import { Action, type CombatController, type ControllerActions, type ControllerContext } from '../../input/actions/Action';
import { autopilotIntent, blendSteering } from './RealAutopilot';
import type { RealModeConfig } from './RealTuning';

const STEERING_KEYS: readonly Action[] = [Action.SteerLeft, Action.SteerRight, Action.MoveForward, Action.MoveBackward];

export class AssistedController implements CombatController {
  private timeS = 0;

  constructor(
    private readonly inner: CombatController,
    private readonly config: RealModeConfig,
    private readonly own: Bey,
    private readonly opponent: Bey,
    private readonly side: 0 | 1,
    /** True for the side a person plays: its stick takes `influence` of the steering. The AI side steers by autopilot alone. */
    private readonly hasStick: boolean,
  ) {}

  sampleActions(context: ControllerContext): ControllerActions {
    const actions = this.inner.sampleActions(context);
    if (!context.simulationFrozen) this.timeS += context.fixedDeltaSeconds;

    const position = this.own.body.translation();
    const opponentPosition = this.opponent.body.translation();
    const auto = autopilotIntent(this.config, {
      position: { x: position.x, z: position.z },
      opponentPosition: { x: opponentPosition.x, z: opponentPosition.z },
      opponentSpin: this.opponent.stamina.resource.fraction,
      spinDir: this.side === 0 ? 1 : -1,
      side: this.side,
      timeS: this.timeS,
    });
    const stick = this.hasStick && actions.moveIntent ? actions.moveIntent : { x: 0, z: 0 };
    const moveIntent = blendSteering(auto, stick, this.config.influence);

    const held = new Set(actions.held);
    for (const key of STEERING_KEYS) held.delete(key);
    return { ...actions, held, moveIntent };
  }
}
