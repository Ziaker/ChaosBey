// ============================================================
// ChaosBeyReplayV1 / V2 (M9 lane B — GDD 77; V2 in M11)
// V2 is V1 plus a required `move` on every action frame (the
// directional-control intent, or null). New recordings are V2; V1 files
// still decode, and their frames keep the classic control semantics.
// The replay file: the resolved deterministic config, the recording
// build's fingerprint, one frame per fixed tick (both sides'
// ControllerActions, indexed by TickIndex) and state checkpoints (keyed by
// TicksCompleted). Nothing else is needed to play a match back.
//
// Encoding is deterministic: object keys sorted at every level, no
// whitespace, numbers as JSON writes them (every finite double round-trips
// exactly). The same replay always encodes to the same bytes. JSON writes
// -0 as 0, which the state hash already treats as equal.
//
// `integrity` is the STATE_HASH_ALGORITHM hash of every other field. It
// catches a corrupted or hand-edited file; it is not a signature (anyone
// can recompute it).
//
// Decoding is strict: anything malformed, of the wrong version or not in
// the canonical shape is rejected with the path and a reason code. A file
// is either fully valid or refused, never partially read.
// ============================================================

import { createDefaultAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import { createDefaultMatchConfig } from '../../config/match/MatchConfig';
import { FIXED_TICKS_PER_SECOND } from '../../physics/fixed-step/FixedTimestepLoop';
import {
  REPLAY_FORMAT,
  REPLAY_FORMAT_V1,
  type ReplayFormat,
  RNG_SCHEME_VERSION,
  STATE_HASH_ALGORITHM,
  STATE_SCHEMA_VERSION,
  type DeterministicConfigSnapshot,
  type RecordedActions,
  type RuntimeFingerprint,
  type StateCheckpoint,
  type TickIndex,
} from '../contracts';
import type { CanonicalValue } from '../state/CanonicalValue';
import { stateHash } from '../state/stateHash';
import { isAction } from './recordedActions';

/** Both sides' actions for one fixed tick. */
export interface ReplayFrame {
  readonly tickIndex: TickIndex;
  readonly first: RecordedActions;
  readonly second: RecordedActions;
}

export interface ChaosBeyReplayV1 {
  /** V1 (classic control only) or V2 (adds `move` to every action frame). */
  readonly format: ReplayFormat;
  readonly stateHashAlgorithm: typeof STATE_HASH_ALGORITHM;
  readonly fingerprint: RuntimeFingerprint;
  readonly config: DeterministicConfigSnapshot;
  /** frames[n].tickIndex === n: every tick from 0, none skipped. */
  readonly frames: readonly ReplayFrame[];
  /** Strictly increasing ticksCompleted, each in [0, frames.length]. */
  readonly checkpoints: readonly StateCheckpoint[];
  readonly integrity: string;
}

export type UnsealedReplay = Omit<ChaosBeyReplayV1, 'integrity'>;

export type ReplayErrorCode =
  | 'malformed-json'
  | 'wrong-format'
  | 'unsupported-version'
  | 'missing-field'
  | 'unknown-field'
  | 'wrong-type'
  | 'non-finite-number'
  | 'invalid-action'
  | 'invalid-tick-index'
  | 'duplicate-frame'
  | 'out-of-order-frame'
  | 'missing-frame'
  | 'invalid-checkpoint'
  | 'integrity-mismatch';

export interface ReplayValidationError {
  readonly code: ReplayErrorCode;
  /** Where in the file, e.g. `frames[12].first.held[1]`. */
  readonly path: string;
  readonly message: string;
}

export type ReplayDecodeResult =
  | { readonly ok: true; readonly replay: ChaosBeyReplayV1 }
  | { readonly ok: false; readonly errors: readonly ReplayValidationError[] };

/** Thrown by encodeReplay() for a replay that wouldn't decode. */
export class InvalidReplayError extends Error {
  constructor(readonly errors: readonly ReplayValidationError[]) {
    super(`Invalid replay: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    this.name = 'InvalidReplayError';
  }
}

// ------------------------------------------------------------
// Encoding
// ------------------------------------------------------------

/** Adds the integrity hash. */
export function sealReplay(unsealed: UnsealedReplay): ChaosBeyReplayV1 {
  return { ...unsealed, integrity: integrityOf(unsealed) };
}

function integrityOf(unsealed: UnsealedReplay): string {
  return stateHash(unsealed as unknown as CanonicalValue);
}

/** Canonical JSON text of a valid replay. Throws InvalidReplayError otherwise (a file that would not decode is never written). */
export function encodeReplay(replay: ChaosBeyReplayV1): string {
  const errors = validateReplay(replay);
  if (errors.length > 0) throw new InvalidReplayError(errors);
  return canonicalJson(replay);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

// ------------------------------------------------------------
// Decoding and validation
// ------------------------------------------------------------

export function decodeReplay(text: string): ReplayDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [{ code: 'malformed-json', path: '(root)', message: error instanceof Error ? error.message : String(error) }] };
  }
  const errors = validateReplay(parsed);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, replay: parsed as ChaosBeyReplayV1 };
}

/** Every problem with `value` as a ChaosBeyReplayV1 (empty = valid, integrity included). */
export function validateReplay(value: unknown): ReplayValidationError[] {
  const v = new Validator();
  if (value === undefined) return [{ code: 'missing-field', path: '(root)', message: 'no replay' }];
  const root = v.record(value, '(root)', ['format', 'stateHashAlgorithm', 'fingerprint', 'config', 'frames', 'checkpoints', 'integrity']);
  if (!root) return v.errors;

  if (root.format !== REPLAY_FORMAT && root.format !== REPLAY_FORMAT_V1) {
    v.fail('wrong-format', 'format', `expected "${REPLAY_FORMAT}" or "${REPLAY_FORMAT_V1}", got ${describe(root.format)}`);
  }
  // An unknown format is checked against the newest shape (its one error is the format itself).
  v.hasMove = root.format !== REPLAY_FORMAT_V1;
  if (root.stateHashAlgorithm !== STATE_HASH_ALGORITHM) {
    v.fail('unsupported-version', 'stateHashAlgorithm', `expected "${STATE_HASH_ALGORITHM}", got ${describe(root.stateHashAlgorithm)}`);
  }
  validateFingerprint(v, root.fingerprint);
  validateConfig(v, root.config);
  const frameCount = validateFrames(v, root.frames);
  validateCheckpoints(v, root.checkpoints, frameCount);
  v.string(root.integrity, 'integrity');

  // Integrity is only meaningful once the content itself is well-formed.
  if (v.errors.length === 0) {
    const { integrity, ...unsealed } = root as unknown as ChaosBeyReplayV1;
    const expected = integrityOf(unsealed);
    if (integrity !== expected) v.fail('integrity-mismatch', 'integrity', `content hashes to ${expected}, file says ${integrity}`);
  }
  return v.errors;
}

function validateFingerprint(v: Validator, value: unknown): void {
  const fp = v.record(value, 'fingerprint', ['buildVersion', 'commit', 'rapierVersion']);
  if (!fp) return;
  v.string(fp.buildVersion, 'fingerprint.buildVersion');
  if (fp.commit !== null) v.string(fp.commit, 'fingerprint.commit');
  v.string(fp.rapierVersion, 'fingerprint.rapierVersion');
}

function validateConfig(v: Validator, value: unknown): void {
  const config = v.record(value, 'config', ['seedText', 'rngScheme', 'stateSchema', 'matchConfig', 'attackProfileSettings', 'spawns', 'beys', 'fixedTicksPerSecond']);
  if (!config) return;
  v.string(config.seedText, 'config.seedText');
  v.version(config.rngScheme, RNG_SCHEME_VERSION, 'config.rngScheme');
  v.version(config.stateSchema, STATE_SCHEMA_VERSION, 'config.stateSchema');
  v.version(config.fixedTicksPerSecond, FIXED_TICKS_PER_SECOND, 'config.fixedTicksPerSecond');
  // Same fields and types as this build's own config objects: a field added
  // or removed since the recording is a version problem, not something to guess.
  v.sameShape(config.matchConfig, createDefaultMatchConfig(), 'config.matchConfig');
  v.sameShape(config.attackProfileSettings, createDefaultAttackProfileSettings(), 'config.attackProfileSettings');
  const spawns = v.record(config.spawns, 'config.spawns', ['first', 'second']);
  if (spawns) {
    for (const side of ['first', 'second'] as const) v.sameShape(spawns[side], { x: 0, y: 0, z: 0 }, `config.spawns.${side}`);
  }
  const beys = v.record(config.beys, 'config.beys', ['first', 'second']);
  if (beys) {
    for (const side of ['first', 'second'] as const) {
      const bey = v.record(beys[side], `config.beys.${side}`, ['definitionId', 'definitionDigest']);
      if (!bey) continue;
      if (v.string(bey.definitionId, `config.beys.${side}.definitionId`) && bey.definitionId === '') {
        v.fail('wrong-type', `config.beys.${side}.definitionId`, 'must not be empty');
      }
      v.hash(bey.definitionDigest, `config.beys.${side}.definitionDigest`);
    }
  }
}

/** Returns the number of frames when the list is usable, else null. */
function validateFrames(v: Validator, value: unknown): number | null {
  if (!Array.isArray(value)) {
    if (value !== undefined) v.fail('wrong-type', 'frames', 'expected an array');
    return null;
  }
  let expected: TickIndex = 0;
  const before = v.errors.length;
  value.forEach((item, i) => {
    const path = `frames[${i}]`;
    const frame = v.record(item, path, ['tickIndex', 'first', 'second']);
    if (!frame) return;
    const t = frame.tickIndex;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 0) {
      v.fail('invalid-tick-index', `${path}.tickIndex`, `expected a non-negative integer, got ${describe(t)}`);
    } else if (t === expected - 1) {
      v.fail('duplicate-frame', `${path}.tickIndex`, `TickIndex ${t} appears twice`);
    } else if (t < expected) {
      v.fail('out-of-order-frame', `${path}.tickIndex`, `TickIndex ${t} after ${expected - 1}`);
    } else if (t > expected) {
      v.fail('missing-frame', `${path}.tickIndex`, `expected TickIndex ${expected}, got ${t} (ticks ${expected}..${t - 1} missing)`);
    }
    if (typeof t === 'number' && Number.isInteger(t) && t >= expected) expected = t + 1;
    validateActions(v, frame.first, `${path}.first`);
    validateActions(v, frame.second, `${path}.second`);
  });
  return v.errors.length === before ? value.length : null;
}

function validateActions(v: Validator, value: unknown, path: string): void {
  const actions = v.record(value, path, v.hasMove ? ['held', 'pressed', 'attackHoldS', 'jumpDriftHoldS', 'move'] : ['held', 'pressed', 'attackHoldS', 'jumpDriftHoldS']);
  if (!actions) return;
  if (v.hasMove && actions.move !== null && actions.move !== undefined) {
    const move = actions.move;
    if (!Array.isArray(move) || move.length !== 2) {
      v.fail('wrong-type', `${path}.move`, 'expected null or an [x, z] pair');
    } else if (v.finite(move[0], `${path}.move[0]`) && v.finite(move[1], `${path}.move[1]`) && Math.hypot(move[0] as number, move[1] as number) > 1 + 1e-9) {
      v.fail('wrong-type', `${path}.move`, 'length must not exceed 1');
    }
  }
  for (const key of ['held', 'pressed'] as const) {
    const list = actions[key];
    if (!Array.isArray(list)) {
      if (list !== undefined) v.fail('wrong-type', `${path}.${key}`, 'expected an array');
      continue;
    }
    list.forEach((item, i) => {
      if (!isAction(item)) v.fail('invalid-action', `${path}.${key}[${i}]`, `${describe(item)} is not an Action`);
      else if (i > 0 && !((list[i - 1] as string) < item)) v.fail('invalid-action', `${path}.${key}[${i}]`, 'actions must be sorted and unique');
    });
  }
  for (const key of ['attackHoldS', 'jumpDriftHoldS'] as const) {
    if (v.finite(actions[key], `${path}.${key}`) && (actions[key] as number) < 0) v.fail('wrong-type', `${path}.${key}`, 'must not be negative');
  }
}

function validateCheckpoints(v: Validator, value: unknown, frameCount: number | null): void {
  if (!Array.isArray(value)) {
    if (value !== undefined) v.fail('wrong-type', 'checkpoints', 'expected an array');
    return;
  }
  let previous = -1;
  value.forEach((item, i) => {
    const path = `checkpoints[${i}]`;
    const cp = v.record(item, path, ['ticksCompleted', 'hash']);
    if (!cp) return;
    const t = cp.ticksCompleted;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 0) {
      v.fail('invalid-checkpoint', `${path}.ticksCompleted`, `expected a non-negative integer, got ${describe(t)}`);
    } else {
      if (t <= previous) v.fail('invalid-checkpoint', `${path}.ticksCompleted`, `${t} is not after ${previous} (checkpoints must be strictly increasing)`);
      if (frameCount !== null && t > frameCount) v.fail('invalid-checkpoint', `${path}.ticksCompleted`, `${t} is past the last frame (${frameCount} ticks recorded)`);
      previous = Math.max(previous, t);
    }
    v.hash(cp.hash, `${path}.hash`);
  });
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

/**
 * Collects errors. Every check below is reached through a parent record()
 * that already reported a missing key, so an `undefined` value is skipped
 * silently instead of being reported twice.
 */
class Validator {
  readonly errors: ReplayValidationError[] = [];
  /** V2: every action frame carries `move`. */
  hasMove = true;

  fail(code: ReplayErrorCode, path: string, message: string): void {
    this.errors.push({ code, path, message });
  }

  /** A plain object with exactly `keys` (missing and unknown keys are both errors). */
  record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> | null {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.fail('wrong-type', path, `expected an object, got ${Array.isArray(value) ? 'an array' : describe(value)}`);
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of keys) if (!(key in record)) this.fail('missing-field', join(path, key), 'missing');
    for (const key of Object.keys(record)) if (!keys.includes(key)) this.fail('unknown-field', join(path, key), 'not part of this replay format');
    return record;
  }

  string(value: unknown, path: string): boolean {
    if (typeof value === 'string') return true;
    if (value !== undefined) this.fail('wrong-type', path, `expected a string, got ${describe(value)}`);
    return false;
  }

  finite(value: unknown, path: string): boolean {
    if (typeof value !== 'number') {
      if (value !== undefined) this.fail('wrong-type', path, `expected a number, got ${describe(value)}`);
      return false;
    }
    if (!Number.isFinite(value)) {
      this.fail('non-finite-number', path, `${value} is not finite`);
      return false;
    }
    return true;
  }

  version(value: unknown, supported: number, path: string): void {
    if (value !== undefined && value !== supported) this.fail('unsupported-version', path, `this build supports ${supported}, the replay has ${describe(value)}`);
  }

  hash(value: unknown, path: string): void {
    if (value !== undefined && (typeof value !== 'string' || !/^[0-9a-f]{16}$/.test(value))) this.fail('wrong-type', path, `expected 16 lowercase hex characters, got ${describe(value)}`);
  }

  /** Same keys and value types as `template`, recursively; every number finite. */
  sameShape(value: unknown, template: unknown, path: string): void {
    if (typeof template === 'number') {
      this.finite(value, path);
    } else if (typeof template === 'string' || typeof template === 'boolean') {
      if (value !== undefined && typeof value !== typeof template) this.fail('wrong-type', path, `expected a ${typeof template}, got ${describe(value)}`);
    } else if (template !== null && typeof template === 'object') {
      const record = this.record(value, path, Object.keys(template));
      if (!record) return;
      for (const [key, sub] of Object.entries(template)) if (key in record) this.sameShape(record[key], sub, join(path, key));
    }
  }
}

function join(path: string, key: string): string {
  return path === '(root)' ? key : `${path}.${key}`;
}
