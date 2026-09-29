// ============================================================
// REPLAY PLAYBACK (M9 lane C)
// From a decoded ChaosBeyReplayV1 to a verified run of the real runtime:
//
// 1. compatibility: the recording build's fingerprint must match this
//    build's (refused by default; allowFingerprintMismatch exists for
//    diagnosis only), each recorded Bey must resolve to a definition
//    this build has with the same gameplay digest, and the replay must
//    carry the checkpoints that make "verified" mean something: the
//    initial state (TicksCompleted 0) and the final one (frames.length).
//    Intermediate checkpoints may be sparse. Format, versions, tick
//    rate and file integrity were already enforced by decodeReplay().
// 2. the match is rebuilt from the replay's own config only: Bey
//    definitions (resolved above), spawns, match config, and
//    NullAiMashSource, as live play uses. Never localStorage or the
//    current defaults.
// 3. the recorded frames drive it through ReplayControllers (headless
//    here; live through MatchSession's 'replay' controller spec), and
//    every checkpoint the replay carries is compared with the state hash
//    the playback reaches.
// ============================================================

import { ALL_BEY_ARCHETYPES } from '../../bey/archetype/BeyArchetypes';
import { DEFAULT_BEY_DEFINITION, type BeyDefinition } from '../../bey/archetype/BeyDefinition';
import type { Bey } from '../../bey/core/Bey';
import { NullAiMashSource } from '../../combat/clash/ClashMash';
import { applyAttackProfileSettings, type BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import { SelfTestMatchWorld } from '../../self-test/SelfTestMatchWorld';
import type { RecordedBey, RuntimeFingerprint, StateCheckpoint, TicksCompleted } from '../contracts';
import type { ChaosBeyReplayV1 } from '../format/ChaosBeyReplayV1';
import { beyDefinitionDigest } from '../format/configSnapshot';
import { fromRecordedActions } from '../format/recordedActions';
import { compareFingerprints, type FingerprintMismatch } from '../format/runtimeFingerprint';
import { compareCheckpoints, type CheckpointComparison } from './divergence';
import { HeadlessReplayRun, type ReplayFrames } from './HeadlessReplayRun';

/** Every Bey definition this build can rebuild a replay with. */
export const REPLAY_BEY_CATALOG: readonly BeyDefinition[] = [...ALL_BEY_ARCHETYPES, DEFAULT_BEY_DEFINITION];

export type ReplayRefusal =
  | { readonly code: 'fingerprint-mismatch'; readonly mismatches: readonly FingerprintMismatch[] }
  | { readonly code: 'unknown-bey'; readonly side: 'first' | 'second'; readonly definitionId: string }
  | { readonly code: 'bey-digest-mismatch'; readonly side: 'first' | 'second'; readonly definitionId: string }
  /** Without the initial and final states a playback could prove nothing, so it is never called verified. */
  | { readonly code: 'missing-boundary-checkpoint'; readonly missing: readonly TicksCompleted[] };

export interface ReplayCompatibilityOptions {
  /** Diagnosis only: play a replay from another build anyway (its hashes are then expected to be able to differ). */
  readonly allowFingerprintMismatch?: boolean;
}

export type ReplayCompatibility =
  | { readonly ok: true; readonly beys: { readonly first: BeyDefinition; readonly second: BeyDefinition }; readonly fingerprintMismatches: readonly FingerprintMismatch[] }
  | { readonly ok: false; readonly refusals: readonly ReplayRefusal[] };

/**
 * The definition a recorded Bey was: same id, same gameplay digest. Tried
 * with the replay's attack-profile settings applied (what a live match
 * uses) and as the plain archetype (what headless batches and scenarios
 * use); the digest decides.
 */
export function resolveRecordedBey(recorded: RecordedBey, settings: BeyAttackProfileSettings): BeyDefinition | 'unknown' | 'digest-mismatch' {
  const base = REPLAY_BEY_CATALOG.find((definition) => definition.id === recorded.definitionId);
  if (!base) return 'unknown';
  for (const candidate of [applyAttackProfileSettings(base, settings), base]) {
    if (beyDefinitionDigest(candidate) === recorded.definitionDigest) return candidate;
  }
  return 'digest-mismatch';
}

export function checkReplayCompatibility(replay: ChaosBeyReplayV1, current: RuntimeFingerprint, options: ReplayCompatibilityOptions = {}): ReplayCompatibility {
  const refusals: ReplayRefusal[] = [];
  const fingerprintMismatches = compareFingerprints(replay.fingerprint, current);
  if (fingerprintMismatches.length > 0 && !options.allowFingerprintMismatch) refusals.push({ code: 'fingerprint-mismatch', mismatches: fingerprintMismatches });
  const missing = missingBoundaryCheckpoints(replay);
  if (missing.length > 0) refusals.push({ code: 'missing-boundary-checkpoint', missing });
  const beys: Partial<Record<'first' | 'second', BeyDefinition>> = {};
  for (const side of ['first', 'second'] as const) {
    const recorded = replay.config.beys[side];
    const resolved = resolveRecordedBey(recorded, replay.config.attackProfileSettings);
    if (resolved === 'unknown') refusals.push({ code: 'unknown-bey', side, definitionId: recorded.definitionId });
    else if (resolved === 'digest-mismatch') refusals.push({ code: 'bey-digest-mismatch', side, definitionId: recorded.definitionId });
    else beys[side] = resolved;
  }
  if (refusals.length > 0 || !beys.first || !beys.second) return { ok: false, refusals };
  return { ok: true, beys: { first: beys.first, second: beys.second }, fingerprintMismatches };
}

/** The boundary states a replay must checkpoint: TicksCompleted 0 and frames.length. */
export function missingBoundaryCheckpoints(replay: ChaosBeyReplayV1): TicksCompleted[] {
  const have = new Set(replay.checkpoints.map((c) => c.ticksCompleted));
  return [...new Set([0, replay.frames.length])].filter((t) => !have.has(t));
}

/** The replay's frames as each side's ControllerActions, `first[n]` for TickIndex n. */
export function framesFromReplay(replay: ChaosBeyReplayV1): ReplayFrames {
  return {
    first: replay.frames.map((frame) => fromRecordedActions(frame.first)),
    second: replay.frames.map((frame) => fromRecordedActions(frame.second)),
  };
}

/**
 * A pre-tick setup to re-apply before playback (a scenario preset's
 * `setup`): a replay recorded after one starts from the post-setup state.
 */
export type PlaybackSetup = (beys: { readonly first: Bey; readonly second: Bey }) => void;

/** The headless match the replay was recorded on, rebuilt from its config alone. */
export async function buildPlaybackWorld(replay: ChaosBeyReplayV1, beys: { readonly first: BeyDefinition; readonly second: BeyDefinition }, setup?: PlaybackSetup): Promise<SelfTestMatchWorld> {
  const world = await SelfTestMatchWorld.build({
    firstSpawn: replay.config.spawns.first,
    secondSpawn: replay.config.spawns.second,
    matchConfigOverrides: replay.config.matchConfig,
    aiMashSource: new NullAiMashSource(),
    firstDefinition: beys.first,
    secondDefinition: beys.second,
  });
  setup?.({ first: world.first, second: world.second });
  return world;
}

export type ReplayVerdict =
  | { readonly status: 'refused'; readonly refusals: readonly ReplayRefusal[] }
  | {
      readonly status: 'verified' | 'diverged' | 'incomplete';
      readonly ticksPlayed: number;
      readonly comparison: CheckpointComparison;
      /** Only when allowFingerprintMismatch let a different build's replay play. */
      readonly fingerprintMismatches: readonly FingerprintMismatch[];
    };

export interface HeadlessPlaybackOptions extends ReplayCompatibilityOptions {
  readonly setup?: PlaybackSetup;
}

/**
 * Plays a replay back headless and checks every checkpoint it carries.
 * `verified` means every stored state hash was reproduced exactly.
 */
export async function playReplayHeadless(replay: ChaosBeyReplayV1, current: RuntimeFingerprint, options: HeadlessPlaybackOptions = {}): Promise<ReplayVerdict> {
  const compatibility = checkReplayCompatibility(replay, current, options);
  if (!compatibility.ok) return { status: 'refused', refusals: compatibility.refusals };
  const world = await buildPlaybackWorld(replay, compatibility.beys, options.setup);
  try {
    const run = new HeadlessReplayRun(world, framesFromReplay(replay));
    const produced: StateCheckpoint[] = run.playToEnd(1);
    const comparison = compareCheckpoints(replay.checkpoints, produced);
    const status = comparison.status === 'match' ? 'verified' : comparison.status;
    return { status, ticksPlayed: run.ticksCompleted, comparison, fingerprintMismatches: compatibility.fingerprintMismatches };
  } finally {
    world.dispose();
  }
}
