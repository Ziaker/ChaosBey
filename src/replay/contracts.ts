// ============================================================
// REPLAY CONTRACTS (Milestone 9 — GDD sections 75, 76, 77, 145, 153)
// The small set of types and version numbers every M9 lane shares:
// canonical state + hash (lane A), replay format + recording (lane B),
// playback + divergence (lane C). Frozen before the lanes start, so they
// can be built in parallel without two definitions of the same thing.
// Changing anything here is a contract change: bump the matching version.
//
// Owner decisions this encodes (docs/ai/m9-status.md):
// - one simulation: hitstop is simulation state, not camera state;
// - per-side AI RNG streams derived from one canonical root seed;
// - a replay carries the resolved deterministic config, never reads
//   localStorage;
// - the official hash comes from an explicit, versioned canonical state,
//   not a physics-engine snapshot;
// - strict float hashing (only -0 and NaN canonicalized, no rounding);
// - record/playback at ControllerActions, per side, per fixed tick;
// - Chromium is the only reference browser.
// ============================================================

import type { Action } from '../input/actions/Action';
import type { MatchConfig } from '../config/match/MatchConfig';
import type { BeyAttackProfileSettings } from '../config/attack-profile/AttackProfileSettings';
import type { SpawnPositionM } from '../app/bootstrap/matchSpawns';

/**
 * Replay file format id new recordings are written in. V2 (M11) adds the
 * directional-control `move` field to every recorded action frame; V1
 * files (GDD 77: "ChaosBeyReplayV1") still decode and play back with the
 * classic semantics they were recorded under.
 */
export const REPLAY_FORMAT = 'ChaosBeyReplayV2';
/** Every format this build decodes. */
export const REPLAY_FORMAT_V1 = 'ChaosBeyReplayV1';
export type ReplayFormat = typeof REPLAY_FORMAT | typeof REPLAY_FORMAT_V1;

/** Version of CanonicalMatchState (lane A). Bump when a field is added, removed or reordered. */
export const STATE_SCHEMA_VERSION = 5; // 2: RoundState carries the ring-out delay clocks; 3: Attack Energy gone, the Dash cooldown in AttackController; 4: each Bey's momentum; 5: the own-jump landing and the drift rule's state (owner, 2026-10-02).

/**
 * How RNG streams are derived from the root seed.
 * 1 = pre-M9: one `ai` stream shared by both AIs live; `${seed}/first|second` headless.
 * 2 = M9: gameplay, ai:first, ai:second, cosmetic — the same derivation live,
 *     in the Debug Lab and headless.
 */
export const RNG_SCHEME_VERSION = 2;

/** Hash algorithm id carried in the replay, so the algorithm can change without guessing. */
export const STATE_HASH_ALGORITHM = 'fnv1a-64';

/** A state hash: 16 lowercase hex characters (64 bits) of STATE_HASH_ALGORITHM over CanonicalMatchState. */
export type StateHash = string;

// Two tick counters, never interchangeable (one number meaning both would
// put replay frames and checkpoints off by one):
//
//   ticksCompleted:  0      1      2      3
//   state:           S0 ──► S1 ──► S2 ──► S3
//   TickIndex:          0      1      2
//
// Executing TickIndex n takes the state from ticksCompleted n to n + 1.
// Ticks frozen by hitstop or a Clash still count in both: controllers are
// sampled on every tick, so a replay records every tick.

/**
 * Zero-based index of one executed fixed tick: 0 is the first tick of the
 * round (the first controller sampling). Replay input frames are indexed
 * by it.
 */
export type TickIndex = number;

/**
 * How many fixed ticks have completed when a state is read: 0 is the
 * initial state, before TickIndex 0; after TickIndex n it is n + 1.
 * CanonicalMatchState and StateCheckpoint carry this, never a TickIndex.
 */
export type TicksCompleted = number;

/** The state count reached once `index` has executed (index + 1). */
export function ticksCompletedAfter(index: TickIndex): TicksCompleted {
  return index + 1;
}

export type { Side } from '../app/session/MatchSession';

/**
 * One side's ControllerActions for one tick, lossless and JSON-safe.
 * `held` and `pressed` are sorted so equal inputs serialize identically.
 * Hold durations are the exact numbers the controller produced.
 */
export interface RecordedActions {
  readonly held: readonly Action[];
  readonly pressed: readonly Action[];
  readonly attackHoldS: number;
  readonly jumpDriftHoldS: number;
  /**
   * V2 only (required there, absent in V1): the directional-control intent
   * as a world [x, z] vector, or null for a classic-semantics frame (AI,
   * scripted, the Classic control setting). Absent = V1 = classic.
   */
  readonly move?: readonly [number, number] | null;
}

/** One side's Bey, identified well enough to refuse a replay whose definition changed. */
export interface RecordedBey {
  readonly definitionId: string;
  /** StateHash-style digest of the BeyDefinition's full content, so an edited definition is detected even under the same id. */
  readonly definitionDigest: string;
}

/**
 * Everything, besides the inputs, that decides how the match plays out.
 * Playback builds the match from this alone (never from localStorage or the
 * current defaults).
 */
export interface DeterministicConfigSnapshot {
  readonly seedText: string;
  readonly rngScheme: number;
  readonly stateSchema: number;
  readonly matchConfig: MatchConfig;
  readonly attackProfileSettings: BeyAttackProfileSettings;
  readonly spawns: { readonly first: SpawnPositionM; readonly second: SpawnPositionM };
  readonly beys: { readonly first: RecordedBey; readonly second: RecordedBey };
  readonly fixedTicksPerSecond: number;
}

/** General compatibility metadata. A mismatch is reported, never silently ignored (GDD 77). */
export interface RuntimeFingerprint {
  readonly buildVersion: string;
  readonly commit: string | null;
  readonly rapierVersion: string;
}

/**
 * The hash of the canonical state after `ticksCompleted` ticks. Keyed by
 * ticksCompleted (not TickIndex), so it equals the state's own field and
 * the initial state (0) can be checked too.
 */
export interface StateCheckpoint {
  readonly ticksCompleted: TicksCompleted;
  readonly hash: StateHash;
}
