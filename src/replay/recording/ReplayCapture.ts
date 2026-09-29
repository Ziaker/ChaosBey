// ============================================================
// REPLAY CAPTURE (M9 lane C)
// The glue between a place that runs ticks (live MatchSession, headless AI
// batches, the scenario runner) and the pure ReplayRecorder (lane B). The
// caller calls afterTick() right after each MatchStepper step; the capture
// reads the state hash there and records the tick with a checkpoint every
// `checkpointEvery` ticks, plus the final state when the recording ends.
//
// To checkpoint the final state without knowing in advance which tick is
// last, the capture holds each tick until the next one arrives (or
// finish()), with its hash read right after it ran. A hash per tick is
// cheap next to the physics step.
// ============================================================

import type { SpawnPositionM } from '../../app/bootstrap/matchSpawns';
import { createDefaultAttackProfileSettings, type BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig, type MatchConfig } from '../../config/match/MatchConfig';
import type { ControllerActions } from '../../input/actions/Action';
import type { SelfTestMatchWorld } from '../../self-test/SelfTestMatchWorld';
import type { DeterministicConfigSnapshot, RuntimeFingerprint, StateHash, TickIndex, TicksCompleted } from '../contracts';
import { ticksCompletedAfter } from '../contracts';
import type { ChaosBeyReplayV1 } from '../format/ChaosBeyReplayV1';
import { captureDeterministicConfig } from '../format/configSnapshot';
import { ReplayRecorder } from '../format/ReplayRecorder';
import { stateHash } from '../state/stateHash';
import { copyControllerActions } from '../playback/ReplayController';

export interface ReplayCaptureOptions {
  readonly fingerprint: RuntimeFingerprint;
  /** A checkpoint every N ticks (default 1: every tick, so a divergence is pinned without a re-run). The final state is always checkpointed. */
  readonly checkpointEvery?: number;
}

interface PendingTick {
  readonly tickIndex: TickIndex;
  readonly first: ControllerActions;
  readonly second: ControllerActions;
  readonly hash: StateHash;
}

export class ReplayCapture {
  private readonly recorder: ReplayRecorder;
  private readonly every: number;
  private pending: PendingTick | null = null;
  private finished = false;

  /**
   * Call before the first tick: the initial state (TicksCompleted 0) is
   * checkpointed here. `readStateHash(n)` must hash the canonical state as
   * it is now, labelled with TicksCompleted n.
   */
  constructor(
    config: DeterministicConfigSnapshot,
    options: ReplayCaptureOptions,
    private readonly readStateHash: (ticksCompleted: TicksCompleted) => StateHash,
  ) {
    const every = options.checkpointEvery ?? 1;
    if (!Number.isInteger(every) || every < 1) throw new Error(`ReplayCapture: checkpointEvery must be a positive integer, got ${every}.`);
    this.every = every;
    this.recorder = new ReplayRecorder(config, options.fingerprint);
    this.recorder.recordInitialCheckpoint({ ticksCompleted: 0, hash: readStateHash(0) });
  }

  /** Right after TickIndex `tickIndex` ran, with the actions the step sampled. */
  afterTick(tickIndex: TickIndex, first: ControllerActions, second: ControllerActions): void {
    if (this.finished) throw new Error('ReplayCapture: already finished.');
    this.flush(false);
    const done = ticksCompletedAfter(tickIndex);
    this.pending = { tickIndex, first: copyControllerActions(first), second: copyControllerActions(second), hash: this.readStateHash(done) };
  }

  /** The finished, validated replay (final state checkpointed). */
  finish(): ChaosBeyReplayV1 {
    if (this.finished) throw new Error('ReplayCapture: already finished.');
    this.flush(true);
    this.finished = true;
    return this.recorder.finish();
  }

  private flush(isLast: boolean): void {
    const tick = this.pending;
    if (tick === null) return;
    this.pending = null;
    const done = ticksCompletedAfter(tick.tickIndex);
    const checkpoint = isLast || done % this.every === 0 ? { ticksCompleted: done, hash: tick.hash } : undefined;
    this.recorder.record(tick.tickIndex, tick.first, tick.second, checkpoint);
  }
}

/** Everything a headless caller must say about the match it records (the world itself doesn't expose its config). */
export interface HeadlessCaptureInput extends ReplayCaptureOptions {
  readonly seedText: string;
  readonly spawns: { readonly first: SpawnPositionM; readonly second: SpawnPositionM };
  /** Defaults to the resolved defaults (what SelfTestMatchWorld uses without overrides). */
  readonly matchConfig?: MatchConfig;
  /** Defaults to the default settings. The Bey digests are taken from the world's own definitions either way. */
  readonly attackProfileSettings?: BeyAttackProfileSettings;
}

/** A capture on a headless world, started now (before its first tick). */
export function startHeadlessCapture(world: SelfTestMatchWorld, input: HeadlessCaptureInput): ReplayCapture {
  const config = captureDeterministicConfig({
    seedText: input.seedText,
    matchConfig: input.matchConfig ?? resolveMatchConfig(),
    attackProfileSettings: input.attackProfileSettings ?? createDefaultAttackProfileSettings(),
    spawns: input.spawns,
    beys: { first: world.first.definition, second: world.second.definition },
  });
  return new ReplayCapture(config, input, (ticksCompleted) => stateHash(world.getCanonicalState(ticksCompleted)));
}
