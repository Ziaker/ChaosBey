// ============================================================
// ACTION SAMPLE BUFFER
// DOM-independent core of KeyboardController's press/hold bookkeeping —
// pulled out into its own pure class so Milestone 4's hitstop-safe input
// buffering is unit-testable without a real `window` (KeyboardController
// itself needs one, so it can't run in this project's node test
// environment).
//
// Milestone 4 (GDD): hitstop must never cost the player a read on their
// own input. While `simulationFrozen` is true, a gameplay action's press
// stays buffered instead of being delivered/cleared — so a tap entirely
// inside a hitstop window still reaches gameplay exactly once, on the
// first unfrozen sample afterward — and the hold-duration clock stops
// advancing entirely, so charge time can't be gained while gameplay isn't
// actually running. UI actions (Pause, DebugToggle) are exempt from all of
// this: they flush immediately every sample regardless of freeze, since
// hitstop is a gameplay-simulation freeze, not an input-readability one.
// ============================================================

import { Action } from '../actions/Action';

const UI_ACTIONS: ReadonlySet<Action> = new Set([Action.Pause, Action.DebugToggle]);

export interface ActionSample {
  pressedThisFrame: ReadonlySet<Action>;
  holdDuration: (action: Action) => number;
}

export class ActionSampleBuffer {
  private readonly pendingPressed = new Set<Action>();
  private readonly holdStartedAtSeconds = new Map<Action, number>();
  private elapsedSeconds = 0;

  /** Call from a keydown handler the instant a key transitions from up to down. */
  registerPress(action: Action): void {
    this.pendingPressed.add(action);
    this.holdStartedAtSeconds.set(action, this.elapsedSeconds);
  }

  /** Call from a keyup handler. */
  registerRelease(action: Action): void {
    this.holdStartedAtSeconds.delete(action);
  }

  /** Call on focus loss or similar — stops any in-progress hold-duration tracking without touching pending (already-completed) presses. */
  clearHoldTracking(): void {
    this.holdStartedAtSeconds.clear();
  }

  /**
   * Advances the hold-duration clock and flushes pending gameplay presses
   * into this frame's result — unless `simulationFrozen`, in which case
   * gameplay presses stay buffered and the clock doesn't advance. UI
   * actions are always flushed immediately either way.
   */
  sample(fixedDeltaSeconds: number, simulationFrozen: boolean): ActionSample {
    const flushedUi = new Set<Action>();
    for (const action of UI_ACTIONS) {
      if (this.pendingPressed.has(action)) {
        flushedUi.add(action);
        this.pendingPressed.delete(action);
      }
    }

    const holdDuration = (action: Action): number => {
      const startedAt = this.holdStartedAtSeconds.get(action);
      return startedAt === undefined ? 0 : this.elapsedSeconds - startedAt;
    };

    if (simulationFrozen) {
      return { pressedThisFrame: flushedUi, holdDuration };
    }

    this.elapsedSeconds += fixedDeltaSeconds;
    const pressedThisFrame = new Set([...this.pendingPressed, ...flushedUi]);
    this.pendingPressed.clear();
    return { pressedThisFrame, holdDuration };
  }
}
