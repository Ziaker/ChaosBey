// M9 lane B: ChaosBeyReplayV1 format, deterministic encoding, strict
// validation, RecordedActions round-trip, config snapshot, fingerprint and
// the pure ReplayRecorder.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { FIRST_SPAWN, SECOND_SPAWN } from '../../src/app/bootstrap/matchSpawns';
import { MatchSession } from '../../src/app/session/MatchSession';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { applyAttackProfileSettings, createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig, type MatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { RNG_SCHEME_VERSION, STATE_SCHEMA_VERSION, type RuntimeFingerprint } from '../../src/replay/contracts';
import {
  decodeReplay,
  encodeReplay,
  InvalidReplayError,
  sealReplay,
  validateReplay,
  type ChaosBeyReplayV1,
  type ReplayErrorCode,
} from '../../src/replay/format/ChaosBeyReplayV1';
import { beyDefinitionDigest, captureDeterministicConfig } from '../../src/replay/format/configSnapshot';
import { fromRecordedActions, toRecordedActions } from '../../src/replay/format/recordedActions';
import { ReplayRecorder } from '../../src/replay/format/ReplayRecorder';
import { compareFingerprints, currentRuntimeFingerprint } from '../../src/replay/format/runtimeFingerprint';
import { SeededRng } from '../../src/rng/SeededRng';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

const FINGERPRINT: RuntimeFingerprint = { buildVersion: 'test', commit: null, rapierVersion: '0.21.0' };
const ALL_ACTIONS = Object.values(Action);

function configInput(matchConfig: MatchConfig = resolveMatchConfig()) {
  const profiles = createDefaultAttackProfileSettings();
  return {
    seedText: 'format-test',
    matchConfig,
    attackProfileSettings: profiles,
    spawns: { first: FIRST_SPAWN, second: SECOND_SPAWN },
    beys: { first: applyAttackProfileSettings(ATTACK_ARCHETYPE, profiles), second: applyAttackProfileSettings(DEFENSE_ARCHETYPE, profiles) },
  };
}

function actions(held: Action[], pressed: Action[] = [], attackHoldS = 0, jumpDriftHoldS = 0): ControllerActions {
  return { held: new Set(held), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: attackHoldS, jumpDriftHoldDurationSeconds: jumpDriftHoldS };
}

/** A small valid replay: 3 ticks, checkpoints at 0 and 3. */
function smallReplay(): ChaosBeyReplayV1 {
  const recorder = new ReplayRecorder(captureDeterministicConfig(configInput()), FINGERPRINT);
  recorder.recordInitialCheckpoint({ ticksCompleted: 0, hash: '0123456789abcdef' });
  recorder.record(0, actions([Action.MoveForward]), actions([]));
  recorder.record(1, actions([Action.Attack, Action.MoveForward], [Action.Attack], 1 / 60), actions([Action.SteerLeft]));
  recorder.record(2, actions([Action.Attack], [], 2 / 60), actions([], [Action.Pause]), { ticksCompleted: 3, hash: 'fedcba9876543210' });
  return recorder.finish();
}

/** A JSON-level copy to tamper with. */
function tamperable(): any {
  return JSON.parse(encodeReplay(smallReplay()));
}

/** Re-seals so the integrity hash matches, isolating the error under test. */
function resealed(raw: any): string {
  const { integrity: _ignored, ...unsealed } = raw;
  return JSON.stringify(sealReplay(unsealed));
}

function expectRejected(text: string, code: ReplayErrorCode, path: string): void {
  const result = decodeReplay(text);
  expect(result.ok, `expected ${code} at ${path}`).toBe(false);
  if (result.ok) return;
  expect(result.errors.map((e) => `${e.code} @ ${e.path}`)).toContain(`${code} @ ${path}`);
}

describe('RecordedActions round-trip', () => {
  it('preserves every action set and the exact hold durations (fuzzed)', () => {
    const rng = SeededRng.fromSeedText('recorded-actions-fuzz');
    const exactFloats = [0, 1 / 60, 0.1 + 0.2, 1 / 3, 5e-324, Number.MIN_VALUE * 3, 1e308, 123.456789012345];
    for (let i = 0; i < 2000; i++) {
      const pick = () => ALL_ACTIONS.filter(() => rng.nextFloat() < 0.3);
      const original = actions(pick(), pick(), exactFloats[i % exactFloats.length]! * rng.nextFloat(), rng.nextFloat() * 10);
      const recorded = toRecordedActions(original);
      // Through JSON, as a file would carry it.
      const back = fromRecordedActions(JSON.parse(JSON.stringify(recorded)));
      expect(back.held).toEqual(original.held);
      expect(back.pressedThisFrame).toEqual(original.pressedThisFrame);
      expect(Object.is(back.attackHoldDurationSeconds, original.attackHoldDurationSeconds)).toBe(true);
      expect(Object.is(back.jumpDriftHoldDurationSeconds, original.jumpDriftHoldDurationSeconds)).toBe(true);
    }
  });

  it('sorts sets, so equal inputs serialize identically, and keeps a UI press with nothing held', () => {
    const a = toRecordedActions(actions([Action.SteerLeft, Action.Attack]));
    const b = toRecordedActions(actions([Action.Attack, Action.SteerLeft]));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const uiOnly = toRecordedActions(actions([], [Action.Pause]));
    expect(uiOnly).toEqual({ held: [], pressed: [Action.Pause], attackHoldS: 0, jumpDriftHoldS: 0 });
  });
});

describe('config snapshot and fingerprint', () => {
  it('carries this build versions and a detached copy of the resolved config', () => {
    const input = configInput(resolveMatchConfig({ clashImpactMultiplier: 1.75 }));
    const snapshot = captureDeterministicConfig(input);
    expect(snapshot.rngScheme).toBe(RNG_SCHEME_VERSION);
    expect(snapshot.stateSchema).toBe(STATE_SCHEMA_VERSION);
    expect(snapshot.fixedTicksPerSecond).toBe(60);
    expect(snapshot.matchConfig.clashImpactMultiplier).toBe(1.75);
    (input.matchConfig as { clashImpactMultiplier: number }).clashImpactMultiplier = 9;
    expect(snapshot.matchConfig.clashImpactMultiplier).toBe(1.75);
    expect(snapshot.beys.first.definitionId).toBe(ATTACK_ARCHETYPE.id);
  });

  it('the definition digest changes with gameplay content, not with presentation', () => {
    const base = beyDefinitionDigest(ATTACK_ARCHETYPE);
    expect(beyDefinitionDigest({ ...ATTACK_ARCHETYPE, handling: { ...ATTACK_ARCHETYPE.handling, maxSpeedMps: ATTACK_ARCHETYPE.handling.maxSpeedMps + 1e-9 } })).not.toBe(base);
    expect(beyDefinitionDigest({ ...ATTACK_ARCHETYPE, attack: { ...ATTACK_ARCHETYPE.attack, dashMaxSpeedMps: 1 } })).not.toBe(base);
    expect(beyDefinitionDigest({ ...ATTACK_ARCHETYPE, name: 'Renamed', appearance: { createVisual: () => ({ ...ATTACK_ARCHETYPE.appearance.createVisual() }) } })).toBe(base);
    expect(beyDefinitionDigest(DEFENSE_ARCHETYPE)).not.toBe(base);
  });

  it('reports the running build and lists every fingerprint mismatch', async () => {
    const current = await currentRuntimeFingerprint();
    expect(current.buildVersion).toBe('test');
    expect(current.commit).toBeNull();
    expect(current.rapierVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(compareFingerprints(current, current)).toEqual([]);
    expect(compareFingerprints({ ...current, commit: 'abc', rapierVersion: '0.1.0' }, current).map((m) => m.field)).toEqual(['commit', 'rapierVersion']);
  });
});

describe('ReplayRecorder', () => {
  it('records a real live AI-vs-AI match; the decoded file gives back every tick exactly', async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(camera);
    const input = configInput();
    const live = await MatchSession.create({
      scene,
      camera,
      seedText: input.seedText,
      matchConfig: input.matchConfig,
      attackProfileSettings: input.attackProfileSettings,
      telemetry: new TelemetryRecorder(),
      stateMachine: new GameStateMachine(),
      controllers: { first: { kind: 'ai', personality: 'archetype' }, second: { kind: 'ai', personality: 'archetype' } },
      keyboard: new IdleController(),
    });
    const recorder = new ReplayRecorder(
      captureDeterministicConfig({ ...input, beys: { first: live.match.first.definition, second: live.match.second.definition } }),
      await currentRuntimeFingerprint(),
    );
    recorder.recordInitialCheckpoint({ ticksCompleted: 0, hash: live.getStateHash() });
    const sampled: { first: ControllerActions; second: ControllerActions }[] = [];
    for (let i = 0; i < 1200 && !live.roundState.isOver; i++) {
      const out = live.tick();
      sampled.push({ first: toRecordedActionsCopy(out.firstActions), second: toRecordedActionsCopy(out.secondActions) });
      const every60 = (i + 1) % 60 === 0;
      recorder.record(out.tickIndex, out.firstActions, out.secondActions, every60 ? { ticksCompleted: i + 1, hash: live.getStateHash() } : undefined);
    }
    live.dispose();
    const replay = recorder.finish();
    expect(replay.config.beys.first.definitionId).toBe(ATTACK_ARCHETYPE.id);

    const decoded = decodeReplay(encodeReplay(replay));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.replay.frames.length).toBe(sampled.length);
    expect(sampled.length).toBeGreaterThan(100);
    decoded.replay.frames.forEach((frame, n) => {
      expect(frame.tickIndex).toBe(n);
      expect(fromRecordedActions(frame.first)).toEqual(sampled[n]!.first);
      expect(fromRecordedActions(frame.second)).toEqual(sampled[n]!.second);
    });
    expect(decoded.replay.checkpoints[0]).toEqual(replay.checkpoints[0]);
  }, 120_000);

  it('refuses a skipped or repeated TickIndex, a misplaced checkpoint and input after finish()', () => {
    const recorder = new ReplayRecorder(captureDeterministicConfig(configInput()), FINGERPRINT);
    expect(() => recorder.record(1, actions([]), actions([]))).toThrow(/got TickIndex 1, expected 0/);
    recorder.record(0, actions([]), actions([]));
    expect(() => recorder.record(0, actions([]), actions([]))).toThrow(/got TickIndex 0, expected 1/);
    expect(() => recorder.record(1, actions([]), actions([]), { ticksCompleted: 1, hash: '0123456789abcdef' })).toThrow(/must have ticksCompleted 2/);
    expect(() => recorder.recordInitialCheckpoint({ ticksCompleted: 0, hash: '0123456789abcdef' })).toThrow(/before any tick/);
    recorder.finish();
    expect(() => recorder.record(1, actions([]), actions([]))).toThrow(/already finished/);
  });

  it('copies what it is given: a controller reusing its Sets later changes nothing', () => {
    const recorder = new ReplayRecorder(captureDeterministicConfig(configInput()), FINGERPRINT);
    const reused = new Set([Action.Attack]);
    recorder.record(0, { held: reused, pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 }, actions([]));
    reused.clear();
    expect(recorder.finish().frames[0]!.first.held).toEqual([Action.Attack]);
  });
});

function toRecordedActionsCopy(a: ControllerActions): ControllerActions {
  return fromRecordedActions(toRecordedActions(a));
}

describe('deterministic encoding', () => {
  it('the same replay always encodes to the same bytes, and decode → encode is the identity', () => {
    const a = encodeReplay(smallReplay());
    const b = encodeReplay(smallReplay());
    expect(a).toBe(b);
    const decoded = decodeReplay(a);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(encodeReplay(decoded.replay)).toBe(a);
    expect(a).not.toMatch(/\s/);
  });

  it('does not depend on the key order of the object it is given', () => {
    const replay = smallReplay();
    const reordered = JSON.parse(JSON.stringify(replay, Object.keys(replay).reverse().concat(...collectKeys(replay))));
    expect(encodeReplay(reordered)).toBe(encodeReplay(replay));
  });

  it('refuses to write an invalid replay', () => {
    const bad = { ...smallReplay(), frames: [] as never[] };
    expect(() => encodeReplay(bad)).toThrow(InvalidReplayError);
  });

  it('never touches localStorage (owner decision 3)', async () => {
    const g = globalThis as { localStorage?: unknown };
    const saved = g.localStorage;
    g.localStorage = new Proxy({}, { get: () => { throw new Error('localStorage was read'); } });
    try {
      const text = encodeReplay(smallReplay());
      expect(decodeReplay(text).ok).toBe(true);
      await currentRuntimeFingerprint();
    } finally {
      g.localStorage = saved;
    }
  });
});

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
  return [...new Set(out)].reverse();
}

describe('strict validation', () => {
  afterEach(() => undefined);

  it('accepts the canonical replay', () => {
    expect(validateReplay(smallReplay())).toEqual([]);
  });

  it('rejects malformed JSON', () => {
    expectRejected('{"format":"ChaosBeyReplayV1",', 'malformed-json', '(root)');
    expectRejected('', 'malformed-json', '(root)');
  });

  it('rejects a wrong format and incompatible versions', () => {
    const cases: [(raw: any) => void, ReplayErrorCode, string][] = [
      [(r) => (r.format = 'ChaosBeyReplayV2'), 'wrong-format', 'format'],
      [(r) => (r.stateHashAlgorithm = 'sha-256'), 'unsupported-version', 'stateHashAlgorithm'],
      [(r) => (r.config.rngScheme = 1), 'unsupported-version', 'config.rngScheme'],
      [(r) => (r.config.stateSchema = 2), 'unsupported-version', 'config.stateSchema'],
      [(r) => (r.config.fixedTicksPerSecond = 30), 'unsupported-version', 'config.fixedTicksPerSecond'],
      [(r) => (r.config.matchConfig.addedLater = 1), 'unknown-field', 'config.matchConfig.addedLater'],
      [(r) => delete r.config.matchConfig.clashImpactMultiplier, 'missing-field', 'config.matchConfig.clashImpactMultiplier'],
    ];
    for (const [mutate, code, path] of cases) {
      const raw = tamperable();
      mutate(raw);
      expectRejected(resealed(raw), code, path);
    }
  });

  it('rejects missing and unknown fields and wrong types', () => {
    const cases: [(raw: any) => void, ReplayErrorCode, string][] = [
      [(r) => delete r.config.seedText, 'missing-field', 'config.seedText'],
      [(r) => delete r.frames[1].second, 'missing-field', 'frames[1].second'],
      [(r) => delete r.checkpoints[0].hash, 'missing-field', 'checkpoints[0].hash'],
      [(r) => delete r.fingerprint, 'missing-field', 'fingerprint'],
      [(r) => (r.extra = true), 'unknown-field', 'extra'],
      [(r) => (r.frames[0].first.note = 'x'), 'unknown-field', 'frames[0].first.note'],
      [(r) => (r.frames = {}), 'wrong-type', 'frames'],
      [(r) => (r.frames[0].first.held = 'MoveForward'), 'wrong-type', 'frames[0].first.held'],
      [(r) => (r.frames[0].first.attackHoldS = '0'), 'wrong-type', 'frames[0].first.attackHoldS'],
      [(r) => (r.frames[0].first.attackHoldS = -0.5), 'wrong-type', 'frames[0].first.attackHoldS'],
      [(r) => (r.config.spawns.first.x = null), 'wrong-type', 'config.spawns.first.x'],
      [(r) => (r.config.beys.second.definitionDigest = 'XYZ'), 'wrong-type', 'config.beys.second.definitionDigest'],
      [(r) => (r.config.beys.first.definitionId = ''), 'wrong-type', 'config.beys.first.definitionId'],
      [(r) => (r.fingerprint.commit = 7), 'wrong-type', 'fingerprint.commit'],
    ];
    for (const [mutate, code, path] of cases) {
      const raw = tamperable();
      mutate(raw);
      expectRejected(resealed(raw), code, path);
    }
  });

  it('rejects non-finite numbers (JSON reads 1e999 as Infinity)', () => {
    const text = resealed(tamperable());
    expectRejected(text.replace('"attackHoldS":0.016666666666666666', '"attackHoldS":1e999'), 'non-finite-number', 'frames[1].first.attackHoldS');
    expectRejected(text.replace(/"clashImpactMultiplier":[^,}]+/, '"clashImpactMultiplier":-1e999'), 'non-finite-number', 'config.matchConfig.clashImpactMultiplier');
    expectRejected(text.replace(/"x":[^,}]+/, '"x":1e999'), 'non-finite-number', 'config.spawns.first.x');
  });

  it('rejects invalid actions: unknown, unsorted, duplicated', () => {
    const cases: [(raw: any) => void, string][] = [
      [(r) => (r.frames[0].first.held = ['Fly']), 'frames[0].first.held[0]'],
      [(r) => (r.frames[1].first.held = ['MoveForward', 'Attack']), 'frames[1].first.held[1]'],
      [(r) => (r.frames[1].first.pressed = ['Attack', 'Attack']), 'frames[1].first.pressed[1]'],
      [(r) => (r.frames[2].second.pressed = [42]), 'frames[2].second.pressed[0]'],
    ];
    for (const [mutate, path] of cases) {
      const raw = tamperable();
      mutate(raw);
      expectRejected(resealed(raw), 'invalid-action', path);
    }
  });

  it('rejects invalid, duplicate, out-of-order and missing frames', () => {
    const cases: [(raw: any) => void, ReplayErrorCode, string][] = [
      [(r) => (r.frames[0].tickIndex = -1), 'invalid-tick-index', 'frames[0].tickIndex'],
      [(r) => (r.frames[1].tickIndex = 1.5), 'invalid-tick-index', 'frames[1].tickIndex'],
      [(r) => (r.frames[1].tickIndex = '1'), 'invalid-tick-index', 'frames[1].tickIndex'],
      [(r) => (r.frames[1] = { ...r.frames[0] }), 'duplicate-frame', 'frames[1].tickIndex'],
      [(r) => ([r.frames[1], r.frames[2]] = [r.frames[2], r.frames[1]]), 'missing-frame', 'frames[1].tickIndex'],
      [(r) => r.frames.push({ ...r.frames[0] }), 'out-of-order-frame', 'frames[3].tickIndex'],
      [(r) => r.frames.splice(1, 1), 'missing-frame', 'frames[1].tickIndex'],
      [(r) => (r.frames[0].tickIndex = 1), 'missing-frame', 'frames[0].tickIndex'],
    ];
    for (const [mutate, code, path] of cases) {
      const raw = tamperable();
      mutate(raw);
      expectRejected(resealed(raw), code, path);
    }
    // Swapped frames: the second one is then out of order.
    const swapped = tamperable();
    [swapped.frames[1], swapped.frames[2]] = [swapped.frames[2], swapped.frames[1]];
    expectRejected(resealed(swapped), 'out-of-order-frame', 'frames[2].tickIndex');
  });

  it('rejects checkpoints that are unsorted, duplicated, past the last frame or badly hashed', () => {
    const cases: [(raw: any) => void, string][] = [
      [(r) => r.checkpoints.reverse(), 'checkpoints[1].ticksCompleted'],
      [(r) => r.checkpoints.push({ ...r.checkpoints[1] }), 'checkpoints[2].ticksCompleted'],
      [(r) => (r.checkpoints[1].ticksCompleted = 4), 'checkpoints[1].ticksCompleted'],
      [(r) => (r.checkpoints[0].ticksCompleted = -1), 'checkpoints[0].ticksCompleted'],
    ];
    for (const [mutate, path] of cases) {
      const raw = tamperable();
      mutate(raw);
      expectRejected(resealed(raw), 'invalid-checkpoint', path);
    }
    const badHash = tamperable();
    badHash.checkpoints[0].hash = 'FEDCBA9876543210';
    expectRejected(resealed(badHash), 'wrong-type', 'checkpoints[0].hash');
  });

  it('rejects tampered content whose integrity hash was not updated', () => {
    const raw = tamperable();
    raw.frames[1].second.held = ['SteerRight'];
    expectRejected(JSON.stringify(raw), 'integrity-mismatch', 'integrity');
    const cp = tamperable();
    cp.checkpoints[1].hash = '0000000000000000';
    expectRejected(JSON.stringify(cp), 'integrity-mismatch', 'integrity');
  });

  it('reports every problem at once, with paths', () => {
    const raw = tamperable();
    raw.format = 'nope';
    raw.frames[0].first.held = ['Fly'];
    raw.config.rngScheme = 1;
    const result = decodeReplay(resealed(raw));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code).sort()).toEqual(['invalid-action', 'unsupported-version', 'wrong-format']);
  });
});
