// ============================================================
// KEYBOARD CONTROLLER
// Bindings are the approved player-facing scheme (GDD section 14):
// Arrow keys = steer/move, Z = attack, X = hop/jump/drift, C = dodge.
// Pause/DebugToggle keys are ordinary engineering choices (not covered by
// the design doc) and can be rebound freely without a design decision.
//
// Press/hold bookkeeping (including Milestone 4's hitstop-safe buffering)
// lives in ActionSampleBuffer, a DOM-independent class this controller
// just feeds raw key events into — kept separate so that logic is
// unit-testable without a real `window`.
// ============================================================

import { Action, type CombatController, type ControllerActions, type ControllerContext } from '../actions/Action';
import { ActionSampleBuffer } from './ActionSampleBuffer';

const KEY_TO_ACTION: Readonly<Record<string, Action>> = {
  ArrowLeft: Action.SteerLeft,
  ArrowRight: Action.SteerRight,
  ArrowUp: Action.MoveForward,
  ArrowDown: Action.MoveBackward,
  KeyZ: Action.Attack,
  KeyX: Action.JumpDrift,
  KeyC: Action.Dodge,
  Escape: Action.Pause,
  F3: Action.DebugToggle,
};

export class KeyboardController implements CombatController {
  private readonly currentlyDown = new Set<Action>();
  private readonly buffer = new ActionSampleBuffer();

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const action = KEY_TO_ACTION[event.code];
    if (!action) return;
    event.preventDefault();
    if (!this.currentlyDown.has(action)) {
      this.buffer.registerPress(action);
    }
    this.currentlyDown.add(action);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_TO_ACTION[event.code];
    if (!action) return;
    this.currentlyDown.delete(action);
    this.buffer.registerRelease(action);
  };

  private readonly handleWindowBlur = (): void => {
    // Clears stuck keys on focus loss (GDD section 131).
    this.currentlyDown.clear();
    this.buffer.clearHoldTracking();
  };

  attach(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
  }

  sampleActions(context: ControllerContext): ControllerActions {
    const { pressedThisFrame, holdDuration } = this.buffer.sample(context.fixedDeltaSeconds, context.simulationFrozen ?? false);

    return {
      held: new Set(this.currentlyDown),
      pressedThisFrame,
      attackHoldDurationSeconds: holdDuration(Action.Attack),
      jumpDriftHoldDurationSeconds: holdDuration(Action.JumpDrift),
    };
  }
}
