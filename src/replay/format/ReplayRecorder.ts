// ============================================================
// REPLAY RECORDER (M9 lane B)
// Pure: it is handed each tick's TickIndex, both sides' ControllerActions
// and optionally a state checkpoint, and builds a ChaosBeyReplayV1. It
// never runs the simulation, reads controllers or touches storage; the
// call sites that run ticks feed it (lane C).
//
// It refuses input that would make an invalid replay at the moment it is
// given (a skipped or repeated TickIndex, a checkpoint that isn't for the
// state right after the tick), so the error points at the caller's bug,
// not at a file rejected later.
// ============================================================

import type { ControllerActions } from '../../input/actions/Action';
import {
  REPLAY_FORMAT,
  STATE_HASH_ALGORITHM,
  ticksCompletedAfter,
  type DeterministicConfigSnapshot,
  type RuntimeFingerprint,
  type StateCheckpoint,
  type TickIndex,
} from '../contracts';
import { sealReplay, validateReplay, InvalidReplayError, type ChaosBeyReplayV1, type ReplayFrame } from './ChaosBeyReplayV1';
import { toRecordedActions } from './recordedActions';

export class ReplayRecorder {
  private readonly frames: ReplayFrame[] = [];
  private readonly checkpoints: StateCheckpoint[] = [];
  private finished = false;

  constructor(
    private readonly config: DeterministicConfigSnapshot,
    private readonly fingerprint: RuntimeFingerprint,
  ) {}

  /** The TickIndex the next record() must carry. */
  get nextTickIndex(): TickIndex {
    return this.frames.length;
  }

  /** The initial state (TicksCompleted 0). Only before the first tick. */
  recordInitialCheckpoint(checkpoint: StateCheckpoint): void {
    this.assertOpen();
    if (this.frames.length > 0 || this.checkpoints.length > 0) throw new Error('ReplayRecorder: the initial checkpoint must come before any tick.');
    if (checkpoint.ticksCompleted !== 0) throw new Error(`ReplayRecorder: the initial checkpoint has ticksCompleted ${checkpoint.ticksCompleted}, expected 0.`);
    this.checkpoints.push({ ticksCompleted: 0, hash: checkpoint.hash });
  }

  /**
   * One executed tick. `checkpoint`, when given, must be the state right
   * after this tick (ticksCompleted = tickIndex + 1).
   */
  record(tickIndex: TickIndex, firstActions: ControllerActions, secondActions: ControllerActions, checkpoint?: StateCheckpoint): void {
    this.assertOpen();
    if (tickIndex !== this.nextTickIndex) throw new Error(`ReplayRecorder: got TickIndex ${tickIndex}, expected ${this.nextTickIndex}.`);
    if (checkpoint !== undefined && checkpoint.ticksCompleted !== ticksCompletedAfter(tickIndex)) {
      throw new Error(`ReplayRecorder: the checkpoint after TickIndex ${tickIndex} must have ticksCompleted ${ticksCompletedAfter(tickIndex)}, got ${checkpoint.ticksCompleted}.`);
    }
    this.frames.push({ tickIndex, first: toRecordedActions(firstActions), second: toRecordedActions(secondActions) });
    if (checkpoint !== undefined) this.checkpoints.push({ ticksCompleted: checkpoint.ticksCompleted, hash: checkpoint.hash });
  }

  /** The finished replay, validated. The recorder takes no more input afterwards. */
  finish(): ChaosBeyReplayV1 {
    this.assertOpen();
    this.finished = true;
    const replay = sealReplay({
      format: REPLAY_FORMAT,
      stateHashAlgorithm: STATE_HASH_ALGORITHM,
      fingerprint: { ...this.fingerprint },
      config: this.config,
      frames: [...this.frames],
      checkpoints: [...this.checkpoints],
    });
    const errors = validateReplay(replay);
    if (errors.length > 0) throw new InvalidReplayError(errors);
    return replay;
  }

  private assertOpen(): void {
    if (this.finished) throw new Error('ReplayRecorder: already finished.');
  }
}
