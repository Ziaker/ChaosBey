// ============================================================
// HEADLESS REPLAY RUN (M9 lane C)
// Plays recorded ControllerActions back through the real headless match
// (SelfTestMatchWorld → MatchStepper → tickMatch), the same step a live
// MatchSession runs, and produces state checkpoints keyed by
// TicksCompleted.
//
// The world must be built exactly as the recorded match was: same Bey
// definitions, spawns, match config and, as live play does,
// NullAiMashSource (a recorded AI's Clash presses are already in its
// frames). Building it from a replay's DeterministicConfigSnapshot is the
// replay format's job; this run only takes the built world.
// ============================================================

import type { ControllerActions } from '../../input/actions/Action';
import type { SelfTestMatchWorld } from '../../self-test/SelfTestMatchWorld';
import type { StateCheckpoint, TicksCompleted } from '../contracts';
import type { CanonicalRecord } from '../state/CanonicalValue';
import { stateHash } from '../state/stateHash';
import type { SteppableRun } from './divergence';
import { ReplayController } from './ReplayController';

export interface ReplayFrames {
  /** `first[n]` / `second[n]`: each side's actions for TickIndex n. Both sides have the same length. */
  readonly first: readonly ControllerActions[];
  readonly second: readonly ControllerActions[];
}

export class HeadlessReplayRun implements SteppableRun {
  private readonly controllers: { readonly first: ReplayController; readonly second: ReplayController };
  private done: TicksCompleted = 0;

  constructor(
    readonly world: SelfTestMatchWorld,
    frames: ReplayFrames,
  ) {
    if (frames.first.length !== frames.second.length) {
      throw new Error(`HeadlessReplayRun: sides have different frame counts (${frames.first.length} vs ${frames.second.length}).`);
    }
    this.controllers = { first: new ReplayController(frames.first, 'first'), second: new ReplayController(frames.second, 'second') };
  }

  get ticksCompleted(): TicksCompleted {
    return this.done;
  }

  /** How many ticks the recording covers (the last reachable TicksCompleted). */
  get length(): number {
    return this.controllers.first.frameCount;
  }

  isFinished(): boolean {
    return this.controllers.first.isExhausted();
  }

  advance(): void {
    this.world.step(this.controllers);
    this.done++;
  }

  canonicalState(): CanonicalRecord {
    return this.world.getCanonicalState(this.done);
  }

  checkpoint(): StateCheckpoint {
    return { ticksCompleted: this.done, hash: stateHash(this.canonicalState()) };
  }

  /**
   * Plays every remaining frame and returns a checkpoint at each
   * TicksCompleted that is a multiple of `every`, plus the final state
   * (TicksCompleted 0 included when starting from the beginning).
   */
  playToEnd(every = 1): StateCheckpoint[] {
    if (!Number.isInteger(every) || every < 1) throw new Error(`HeadlessReplayRun.playToEnd: 'every' must be a positive integer, got ${every}.`);
    const out: StateCheckpoint[] = [];
    if (this.done % every === 0) out.push(this.checkpoint());
    while (!this.isFinished()) {
      this.advance();
      if (this.done % every === 0 || this.isFinished()) out.push(this.checkpoint());
    }
    return out;
  }
}
