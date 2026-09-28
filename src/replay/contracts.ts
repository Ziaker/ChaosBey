// ============================================================
// M9 CONTRACTS — SHARED MINIMUM SURFACE FOR REPLAY/STATE-HASH WORK
// GDD sections 76, 145, 153. Types only, no logic: this file exists so the
// Lane A (state hash/canonical state/hitstop/RNG), Lane B (replay
// schema/recording), Lane C (playback) and Lane D (divergence/reporting)
// work packages can be built independently against one frozen shape.
// Versioned so a future format change is detectable rather than silently
// misread.
// ============================================================

import type { Action, ControllerActions } from '../input/actions/Action';
import type { MatchConfig } from '../config/match/MatchConfig';

/** Bumped whenever ReplayHeader/ReplayFrame/ReplayCheckpoint's on-disk shape changes incompatibly. */
export const REPLAY_FORMAT_VERSION = 1;

/** Bumped whenever CanonicalMatchStateV1's field set or semantics change. */
export const CANONICAL_STATE_VERSION = 1;

/** Bumped whenever RNG stream derivation changes (GDD 73/153: schema v2 splits AI into aiFirst/aiSecond). */
export const RNG_SCHEMA_VERSION = 2;

/**
 * Lossless, plain-data mirror of ControllerActions (which holds live Sets,
 * unsuitable for serialization/equality comparison). One recorded per side
 * per tick.
 */
export interface SerializedControllerActions {
  readonly held: readonly Action[];
  readonly pressedThisFrame: readonly Action[];
  readonly attackHoldDurationSeconds: number;
  readonly jumpDriftHoldDurationSeconds: number;
}

export function serializeControllerActions(actions: ControllerActions): SerializedControllerActions {
  return {
    held: [...actions.held],
    pressedThisFrame: [...actions.pressedThisFrame],
    attackHoldDurationSeconds: actions.attackHoldDurationSeconds,
    jumpDriftHoldDurationSeconds: actions.jumpDriftHoldDurationSeconds,
  };
}

/** Build/runtime identity a replay or report was produced under — for triage when a hash mismatch might just be "different build", not a real bug. */
export interface BuildFingerprint {
  readonly appBuildVersion: string;
  readonly appCommitHash: string | null;
  readonly canonicalStateVersion: number;
  readonly rngSchemaVersion: number;
  readonly replayFormatVersion: number;
}

/**
 * Metadata for one recorded replay. Everything needed to reconstruct the
 * starting conditions deterministically, short of the frame data itself.
 */
export interface ReplayHeader {
  readonly formatVersion: number;
  readonly seedText: string;
  readonly firstDefinitionId: string;
  readonly secondDefinitionId: string;
  /** Set only when a side is AI-driven; omitted for keyboard/scripted/idle. */
  readonly firstPersonalityId?: string;
  readonly secondPersonalityId?: string;
  readonly matchConfig: MatchConfig;
  readonly build: BuildFingerprint;
  readonly createdAtIso: string;
}

/** One recorded tick: exactly the inputs `tickMatch` consumed, nothing derived. */
export interface ReplayFrame {
  readonly tick: number;
  readonly firstActions: SerializedControllerActions;
  readonly secondActions: SerializedControllerActions;
}

/** A periodic state-hash embedded in a recording, so divergence can be localized without re-hashing every tick after the fact. */
export interface ReplayCheckpoint {
  readonly tick: number;
  readonly hash: StateHashResult;
}

/** Which top-level section of CanonicalMatchStateV1 a hash covers — lets a mismatch be localized without re-serializing the whole state. */
export type StateHashSection = 'first' | 'second' | 'match';

/** The result of hashing a CanonicalMatchStateV1 (or one of its sections). */
export interface StateHashResult {
  readonly canonicalStateVersion: number;
  readonly tick: number;
  /** Hex-encoded digest. Deliberately opaque here — StateHash.ts owns the algorithm. */
  readonly hash: string;
  /** One hash per section, in a fixed order, so a diverging section is identifiable without re-hashing the whole state. Absent for a section-scoped result. */
  readonly sections?: Readonly<Record<StateHashSection, string>>;
}

/** Replaces AiBatchRunner's UnsupportedDivergence once Lane D is implemented. */
export interface DivergenceResult {
  readonly status: 'match' | 'diverged' | 'unsupported';
  readonly firstDivergentTick: number | null;
  /** Number of diverging checkpoints found; null while unsupported. */
  readonly count: number | null;
  readonly reason?: string;
}
