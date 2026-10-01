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

import { Action, UI_ACTIONS, type CombatController, type ControllerActions, type ControllerContext } from '../actions/Action';
import { ActionSampleBuffer } from './ActionSampleBuffer';
import { isEditableEventTarget } from './EditableTarget';

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
  F4: Action.SettingsToggle,
};

export class KeyboardController implements CombatController {
  private readonly currentlyDown = new Set<Action>();
  private readonly buffer = new ActionSampleBuffer();

  /**
   * `onInputDisrupted`: called from handleWindowBlur (so on detach() too —
   * see its own comment), after currentlyDown/the hold buffer are already
   * cleared. Lets a caller that owns gameplay state of its own, outside
   * ControllerActions (e.g. DriftController's jump input buffer — GDD
   * section on the jump-input-buffer hotfix), forget it at the exact same
   * moment this controller forgets every held/pending key, instead of
   * risking the two falling out of sync.
   */
  constructor(private readonly onInputDisrupted?: () => void) {}

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const action = KEY_TO_ACTION[event.code];
    if (!action) return;
    // Typing into a settings field: arrows/Z/X/C belong to the field (and
    // must not drive the Bey). UI keys (F3/F4/Esc) still work from there.
    // keyup is deliberately NOT filtered, so a key already held before
    // focus moved into a field still releases normally.
    if (!UI_ACTIONS.has(action) && isEditableEventTarget(event.target)) return;
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
    this.onInputDisrupted?.();
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
    // A key released while detached (e.g. during a pause menu) never sends
    // its keyup here: forget everything, as on focus loss, so it can't stay
    // stuck held and swallow its next press.
    this.handleWindowBlur();
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
