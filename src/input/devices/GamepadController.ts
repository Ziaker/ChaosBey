// ============================================================
// GAMEPAD CONTROLLER (M10)
// Polls the first connected pad once per fixed tick and feeds the same
// ActionSampleBuffer the keyboard uses, so press edges, hold durations and
// hitstop buffering behave exactly like keys (GDD 14: one action layer for
// every device).
// ============================================================

import { Action, type CombatController, type ControllerActions, type ControllerContext } from '../actions/Action';
import { ActionSampleBuffer } from './ActionSampleBuffer';
import { currentGamepads, gamepadHeldActions, readFirstGamepad } from './gamepadMapping';

export class GamepadController implements CombatController {
  private readonly buffer = new ActionSampleBuffer();
  private held = new Set<Action>();
  /** Buttons down when the controller was (re)started: ignored until released, like a key held from a menu. */
  private readonly ignored = new Set<Action>();
  private ignoreHeldOnNextSample = true;

  constructor(private readonly readPads: () => readonly (Gamepad | null)[] = currentGamepads) {}

  sampleActions(context: ControllerContext): ControllerActions {
    const pad = readFirstGamepad(this.readPads());
    const raw = pad ? gamepadHeldActions(pad.snapshot) : new Set<Action>();
    if (this.ignoreHeldOnNextSample) {
      this.ignoreHeldOnNextSample = false;
      raw.forEach((a) => this.ignored.add(a));
    }
    for (const action of [...this.ignored]) if (!raw.has(action)) this.ignored.delete(action);
    const next = new Set([...raw].filter((a) => !this.ignored.has(a)));
    for (const action of next) if (!this.held.has(action)) this.buffer.registerPress(action);
    for (const action of this.held) if (!next.has(action)) this.buffer.registerRelease(action);
    this.held = next;

    const { pressedThisFrame, holdDuration } = this.buffer.sample(context.fixedDeltaSeconds, context.simulationFrozen ?? false);
    return {
      held: new Set(this.held),
      pressedThisFrame,
      attackHoldDurationSeconds: holdDuration(Action.Attack),
      jumpDriftHoldDurationSeconds: holdDuration(Action.JumpDrift),
    };
  }

  /** Forgets every held button (pause/resume): a button still down must be released and pressed again. */
  reset(): void {
    this.held.clear();
    this.buffer.clearHoldTracking();
    this.ignoreHeldOnNextSample = true;
  }
}

/**
 * Several devices driving one side (keyboard + gamepad): an action is held
 * or pressed if any device has it; hold durations take the longest.
 */
export class CombinedController implements CombatController {
  constructor(private readonly controllers: readonly CombatController[]) {}

  sampleActions(context: ControllerContext): ControllerActions {
    const samples = this.controllers.map((c) => c.sampleActions(context));
    const held = new Set<Action>();
    const pressedThisFrame = new Set<Action>();
    let attackHold = 0;
    let jumpHold = 0;
    for (const sample of samples) {
      sample.held.forEach((a) => held.add(a));
      sample.pressedThisFrame.forEach((a) => pressedThisFrame.add(a));
      attackHold = Math.max(attackHold, sample.attackHoldDurationSeconds);
      jumpHold = Math.max(jumpHold, sample.jumpDriftHoldDurationSeconds);
    }
    return { held, pressedThisFrame, attackHoldDurationSeconds: attackHold, jumpDriftHoldDurationSeconds: jumpHold };
  }
}
