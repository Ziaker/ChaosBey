// ============================================================
// SCRIPTED CONTROLLER
// Drives the same CombatController interface a keyboard/AI controller
// uses (GDD section 113), so deterministic physics/combat scenarios can
// be scripted and replayed exactly — the foundation self-test scenarios
// need (GDD section 150) build on this rather than a separate "fake"
// input path.
// ============================================================

import { Action, type CombatController, type ControllerActions, type ControllerContext } from '../../input/actions/Action';

export interface ScriptedFrame {
  /** Tick this held-set becomes active (inclusive), until the next frame's fromTick. */
  fromTick: number;
  held: Action[];
}

export class ScriptedController implements CombatController {
  private currentTick = 0;
  private readonly frames: ScriptedFrame[];
  private previousHeld = new Set<Action>();
  private readonly holdStartedAtTick = new Map<Action, number>();

  constructor(frames: ScriptedFrame[]) {
    this.frames = [...frames].sort((a, b) => a.fromTick - b.fromTick);
  }

  sampleActions(context: ControllerContext): ControllerActions {
    let activeHeld = new Set<Action>();
    for (const frame of this.frames) {
      if (frame.fromTick <= this.currentTick) {
        activeHeld = new Set(frame.held);
      }
    }

    const pressedThisFrame = new Set<Action>();
    for (const action of activeHeld) {
      if (!this.previousHeld.has(action)) {
        pressedThisFrame.add(action);
        this.holdStartedAtTick.set(action, this.currentTick);
      }
    }
    for (const action of this.previousHeld) {
      if (!activeHeld.has(action)) {
        this.holdStartedAtTick.delete(action);
      }
    }

    const holdDurationSeconds = (action: Action): number => {
      const startedAtTick = this.holdStartedAtTick.get(action);
      return startedAtTick === undefined ? 0 : (this.currentTick - startedAtTick) * context.fixedDeltaSeconds;
    };

    const result: ControllerActions = {
      held: activeHeld,
      pressedThisFrame,
      attackHoldDurationSeconds: holdDurationSeconds(Action.Attack),
      jumpDriftHoldDurationSeconds: holdDurationSeconds(Action.JumpDrift),
    };

    this.previousHeld = activeHeld;
    this.currentTick++;
    return result;
  }
}
