// ============================================================
// KEYBOARD CONTROLLER
// Bindings are the approved player-facing scheme (GDD section 14):
// Arrow keys = steer/move, Z = attack, X = hop/jump/drift, C = dodge.
// Pause/DebugToggle keys are ordinary engineering choices (not covered by
// the design doc) and can be rebound freely without a design decision.
// ============================================================

import { Action, type CombatController, type ControllerActions, type ControllerContext } from '../actions/Action';

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
  private readonly pressedSinceLastSample = new Set<Action>();
  private readonly holdStartedAtSeconds = new Map<Action, number>();
  private elapsedSeconds = 0;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const action = KEY_TO_ACTION[event.code];
    if (!action) return;
    event.preventDefault();
    if (!this.currentlyDown.has(action)) {
      this.pressedSinceLastSample.add(action);
      this.holdStartedAtSeconds.set(action, this.elapsedSeconds);
    }
    this.currentlyDown.add(action);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_TO_ACTION[event.code];
    if (!action) return;
    this.currentlyDown.delete(action);
    this.holdStartedAtSeconds.delete(action);
  };

  private readonly handleWindowBlur = (): void => {
    // Clears stuck keys on focus loss (GDD section 131).
    this.currentlyDown.clear();
    this.holdStartedAtSeconds.clear();
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
    this.elapsedSeconds += context.fixedDeltaSeconds;

    const held: ReadonlySet<Action> = new Set(this.currentlyDown);
    const pressedThisFrame: ReadonlySet<Action> = new Set(this.pressedSinceLastSample);
    this.pressedSinceLastSample.clear();

    const holdDuration = (action: Action): number => {
      const startedAt = this.holdStartedAtSeconds.get(action);
      return startedAt === undefined ? 0 : this.elapsedSeconds - startedAt;
    };

    return {
      held,
      pressedThisFrame,
      attackHoldDurationSeconds: holdDuration(Action.Attack),
      jumpDriftHoldDurationSeconds: holdDuration(Action.JumpDrift),
    };
  }
}
