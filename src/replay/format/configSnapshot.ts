// ============================================================
// DETERMINISTIC CONFIG SNAPSHOT (M9 lane B — owner decision 3)
// Captures, at record time, everything besides the inputs that decides how
// a match plays out, so playback builds the match from the replay alone
// and never from localStorage or the current defaults.
//
// Bey definitions are identified by id plus a digest of their gameplay
// content (physical, ratings, handling, attack), so a definition edited
// under the same id is detected. Presentation (particle, audio,
// appearance) is left out: it never changes the simulation, and
// appearance holds functions that can't be hashed.
// ============================================================

import type { SpawnPositionM } from '../../app/bootstrap/matchSpawns';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import type { BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import type { MatchConfig } from '../../config/match/MatchConfig';
import type { LaunchResult } from '../../launch/LaunchResult';
import { FIXED_TICKS_PER_SECOND } from '../../physics/fixed-step/FixedTimestepLoop';
import { RNG_SCHEME_VERSION, STATE_SCHEMA_VERSION, type DeterministicConfigSnapshot, type RecordedBey } from '../contracts';
import { plainData } from '../state/CanonicalValue';
import { stateHash } from '../state/stateHash';

/** STATE_HASH_ALGORITHM digest of a definition's gameplay content (see header). */
export function beyDefinitionDigest(definition: BeyDefinition): string {
  return stateHash(
    plainData({
      id: definition.id,
      physical: definition.physical,
      ratings: definition.ratings,
      handling: definition.handling,
      attack: definition.attack,
    }),
  );
}

export function recordBey(definition: BeyDefinition): RecordedBey {
  return { definitionId: definition.id, definitionDigest: beyDefinitionDigest(definition) };
}

export interface ConfigSnapshotInput {
  readonly seedText: string;
  readonly matchConfig: MatchConfig;
  readonly attackProfileSettings: BeyAttackProfileSettings;
  readonly spawns: { readonly first: SpawnPositionM; readonly second: SpawnPositionM };
  /** The definitions the match actually used (attack-profile settings already applied). */
  readonly beys: { readonly first: BeyDefinition; readonly second: BeyDefinition };
  /** The Launch System's result for this match, if it began with a launch. */
  readonly launch?: LaunchResult | null;
}

/**
 * The resolved config as plain data, detached from the live objects (a
 * later change to them can't alter a recording). Versions and the tick
 * rate are the running build's.
 */
export function captureDeterministicConfig(input: ConfigSnapshotInput): DeterministicConfigSnapshot {
  const copy = <T>(value: T): T => plainData(value) as T;
  return {
    seedText: input.seedText,
    rngScheme: RNG_SCHEME_VERSION,
    stateSchema: STATE_SCHEMA_VERSION,
    matchConfig: copy(input.matchConfig),
    attackProfileSettings: copy(input.attackProfileSettings),
    spawns: { first: copy(input.spawns.first), second: copy(input.spawns.second) },
    beys: { first: recordBey(input.beys.first), second: recordBey(input.beys.second) },
    fixedTicksPerSecond: FIXED_TICKS_PER_SECOND,
    ...(input.launch ? { launch: copy(input.launch) } : {}),
  };
}
