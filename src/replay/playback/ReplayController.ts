// ============================================================
// REPLAY CONTROLLER (M9 lane C — owner decision 7)
// A CombatController that returns recorded ControllerActions, one frame per
// sample, in TickIndex order. It drives the real runtime (MatchStepper,
// live MatchSession or headless SelfTestMatchWorld): there is no second
// simulator.
//
// It ignores `simulationFrozen`. A recorded frame is what the original
// controller returned *after* handling the freeze (buffering a press made
// during hitstop, not advancing hold clocks), and the replayed match
// freezes on exactly the same ticks because hitstop is simulation state.
// So frame n is always the answer for TickIndex n, frozen or not.
// ============================================================

import type { Action, CombatController, ControllerActions } from '../../input/actions/Action';
import type { TickIndex } from '../contracts';

/** Thrown when the match asks for a tick the recording doesn't have. */
export class ReplayExhaustedError extends Error {
  constructor(
    readonly label: string,
    readonly tickIndex: TickIndex,
    readonly frameCount: number,
  ) {
    super(`ReplayController(${label}): no frame for TickIndex ${tickIndex} (recording has ${frameCount} frames).`);
    this.name = 'ReplayExhaustedError';
  }
}

/**
 * A detached copy of one sample. Controllers may reuse their Set instances
 * between samples, so a capture site must copy before storing.
 */
export function copyControllerActions(actions: ControllerActions): ControllerActions {
  return {
    held: new Set<Action>(actions.held),
    pressedThisFrame: new Set<Action>(actions.pressedThisFrame),
    attackHoldDurationSeconds: actions.attackHoldDurationSeconds,
    jumpDriftHoldDurationSeconds: actions.jumpDriftHoldDurationSeconds,
  };
}

export class ReplayController implements CombatController {
  private readonly frames: readonly ControllerActions[];
  private next: TickIndex = 0;

  /** `frames[n]` is this side's actions for TickIndex n. */
  constructor(
    frames: readonly ControllerActions[],
    readonly label = 'replay',
  ) {
    this.frames = frames.map(copyControllerActions);
  }

  /** The TickIndex the next sample answers for. */
  get nextTickIndex(): TickIndex {
    return this.next;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  isExhausted(): boolean {
    return this.next >= this.frames.length;
  }

  sampleActions(): ControllerActions {
    const frame = this.frames[this.next];
    if (frame === undefined) throw new ReplayExhaustedError(this.label, this.next, this.frames.length);
    this.next++;
    return frame;
  }
}
