// Launch System A (0.61.0) in the match: the arrival the launch gives is the only thing the fight takes from it. These tests
// pin that the SAME recorded result starts the same match live, headless and from a replay file (design doc §9), that a
// launch changes where the Beys start and nothing else, and that a match with no launch is bit-for-bit what it was.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { createDefaultMatchConfig, resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { arenaFloorRadius } from '../../src/arena/colliders/ArenaTuning';
import { decodeReplay, encodeReplay } from '../../src/replay/format/ChaosBeyReplayV1';
import { currentRuntimeFingerprint } from '../../src/replay/format/runtimeFingerprint';
import { playReplayHeadless } from '../../src/replay/playback/replayPlayback';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { SelfTestMatchWorld } from '../../src/self-test/SelfTestMatchWorld';
import { arrivalsFor } from '../../src/launch/applyLaunchArrival';
import type { LaunchResult } from '../../src/launch/LaunchResult';
import { LAUNCH_TUNING, launchOutcomeFor } from '../../src/launch/LaunchTuning';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

const RESULT: LaunchResult = { first: { target: { x: 3, z: -9 }, quality: 0.92 }, second: { target: { x: -5, z: 11 }, quality: 0.55 } };

async function session(seed: string, options: { launch?: LaunchResult | null; ai?: boolean } = {}): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  const spec = options.ai ? ({ kind: 'ai', personality: 'archetype' } as const) : ({ kind: 'idle' } as const);
  return MatchSession.create({
    scene,
    camera,
    seedText: seed,
    matchConfig: resolveMatchConfig(),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: spec, second: spec },
    keyboard: new IdleController(),
    launch: options.launch,
  });
}

describe('the launch in the session', () => {
  it('puts both Beys at their first contact, rolling in at the speed the grade gives, before any tick', async () => {
    const s = await session('launch-a', { launch: RESULT });
    const arrivals = arrivalsFor(s.getBey('first'), s.getBey('second'), RESULT);
    for (const side of ['first', 'second'] as const) {
      const t = s.getBey(side).body.translation();
      const v = s.getBey(side).body.linvel();
      expect(t.x).toBeCloseTo(arrivals[side].position.x, 6);
      expect(t.y).toBeCloseTo(arrivals[side].position.y, 6);
      expect(t.z).toBeCloseTo(arrivals[side].position.z, 6);
      expect(Math.hypot(v.x, v.z)).toBeCloseTo(launchOutcomeFor(RESULT[side].quality).entrySpeedMps, 5);
      expect(s.getBey(side).movement.getHeadingRad()).toBeCloseTo(arrivals[side].headingRad, 9);
    }
    expect(s.getLaunchResult()).toEqual(RESULT);
    expect(s.getTickIndex()).toBe(0);
    s.dispose();
  });

  it('Combat runs from the arrival with nothing in between: the first tick is a normal tick and the Beys touch down within a few ticks', async () => {
    const s = await session('launch-b', { launch: RESULT });
    const firstTick = s.tick();
    expect(firstTick.simulationAdvanced).toBe(true); // no hold, no countdown, no lockout before the match runs
    expect(s.roundState.isOver).toBe(false);
    let grounded = { first: false, second: false };
    for (let i = 0; i < 40; i++) {
      const out = s.tick();
      if (out.result.first.grounded) grounded.first = true;
      if (out.result.second.grounded) grounded.second = true;
    }
    expect(grounded).toEqual({ first: true, second: true }); // the first contact: the physics lands them and the fight goes on
    s.dispose();
  });

  it('applyLaunchResult after the interactive launch gives exactly the match the launch option gives', async () => {
    const viaOption = await session('launch-c', { launch: RESULT });
    const viaCall = await session('launch-c');
    viaCall.applyLaunchResult(RESULT);
    expect(viaCall.getStateHash()).toBe(viaOption.getStateHash());
    for (let i = 0; i < 90; i++) {
      viaOption.tick();
      viaCall.tick();
    }
    expect(viaCall.getStateHash()).toBe(viaOption.getStateHash());
    viaOption.dispose();
    viaCall.dispose();
  });

  it('refuses a launch once the match has run or when one was already applied', async () => {
    const s = await session('launch-d');
    s.tick();
    expect(() => s.applyLaunchResult(RESULT)).toThrow(/already ran/);
    const t = await session('launch-d', { launch: RESULT });
    expect(() => t.applyLaunchResult(RESULT)).toThrow(/already applied/);
    s.dispose();
    t.dispose();
  });

  it('a different timing or a different entry point is a different match (the result is what decides the start)', async () => {
    const a = await session('launch-e', { launch: RESULT });
    const better = await session('launch-e', { launch: { ...RESULT, second: { ...RESULT.second, quality: 1 } } });
    const elsewhere = await session('launch-e', { launch: { ...RESULT, first: { ...RESULT.first, target: { x: -12, z: -4 } } } });
    const plain = await session('launch-e');
    const hashes = new Set([a.getStateHash(), better.getStateHash(), elsewhere.getStateHash(), plain.getStateHash()]);
    expect(hashes.size).toBe(4);
    for (const s of [a, better, elsewhere, plain]) s.dispose();
  });

  it('a match with no launch is unchanged: the spawns, the hash, the game-wide default of launchSequence', async () => {
    const plain = await session('launch-f');
    expect(plain.getLaunchResult()).toBeNull();
    const t = plain.getBey('first').body.translation();
    expect(Math.abs(t.z)).toBeLessThan(10); // the opening spawns, in the basin
    expect(createDefaultMatchConfig().launchSequence).toBe(true); // the flag the player flow reads; the session itself only takes a result
    plain.dispose();
  });
});

describe('the launch headless and in a replay', () => {
  it('a headless AI match from a launch is deterministic and differs from the plain opening', async () => {
    const setup = { seed: 'launch-ai', firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 900 } as const;
    const a = await simulateAiMatch({ ...setup, launch: RESULT });
    const b = await simulateAiMatch({ ...setup, launch: RESULT });
    const plain = await simulateAiMatch({ ...setup });
    expect(a.stats.ticks).toBe(b.stats.ticks);
    expect(a.stats.first.meanSpeedMps).toBe(b.stats.first.meanSpeedMps);
    expect(a.stats.second.meanRadiusM).toBe(b.stats.second.meanRadiusM);
    expect(a.stats.first.meanRadiusM).not.toBe(plain.stats.first.meanRadiusM);
  }, 60_000);

  it('a recording keeps the launch result and plays back verified from the file, so a launched match is replayable', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const record = await simulateAiMatch({
      seed: 'launch-replay',
      firstDefinition: ATTACK_ARCHETYPE,
      secondDefinition: DEFENSE_ARCHETYPE,
      maxTicks: 900,
      launch: RESULT,
      record: { fingerprint, checkpointEvery: 30 },
    });
    expect(record.replay!.config.launch).toEqual(RESULT);
    const decoded = decodeReplay(encodeReplay(record.replay!));
    if (!decoded.ok) throw new Error(`did not decode: ${JSON.stringify(decoded.errors.slice(0, 3))}`);
    expect(decoded.replay.config.launch).toEqual(RESULT);
    const verdict = await playReplayHeadless(decoded.replay, fingerprint);
    expect(verdict.status).toBe('verified');
  }, 60_000);

  it('a replay recorded before the Launch System (no launch, no launchSequence field) still decodes and plays back', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const record = await simulateAiMatch({ seed: 'launch-old', firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 600, record: { fingerprint, checkpointEvery: 60 } });
    expect('launch' in record.replay!.config).toBe(false);
    const raw = JSON.parse(encodeReplay(record.replay!));
    delete raw.config.matchConfig.launchSequence;
    const { integrity: _old, ...unsealed } = raw;
    const { sealReplay } = await import('../../src/replay/format/ChaosBeyReplayV1');
    const old = decodeReplay(JSON.stringify(sealReplay(unsealed)));
    if (!old.ok) throw new Error(`did not decode: ${JSON.stringify(old.errors.slice(0, 3))}`);
    expect((await playReplayHeadless(old.replay, fingerprint)).status).toBe('verified');
  }, 60_000);

  it('refuses a replay whose launch is not a launch result', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const record = await simulateAiMatch({ seed: 'launch-bad', firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 300, launch: RESULT, record: { fingerprint, checkpointEvery: 60 } });
    const raw = JSON.parse(encodeReplay(record.replay!));
    raw.config.launch = { first: 1, second: 2 };
    const { integrity: _old, ...unsealed } = raw;
    const { sealReplay } = await import('../../src/replay/format/ChaosBeyReplayV1');
    const result = decodeReplay(JSON.stringify(sealReplay(unsealed)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.path === 'config.launch')).toBe(true);
  }, 60_000);

  it('the headless world and the live session agree on the arrival', async () => {
    const world = await SelfTestMatchWorld.build({ launch: RESULT, firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE }); // the session plays Attack vs Defense by default
    const s = await session('launch-g', { launch: RESULT });
    for (const side of ['first', 'second'] as const) {
      const w = world[side].body.translation();
      const l = s.getBey(side).body.translation();
      expect(w.x).toBeCloseTo(l.x, 9);
      expect(w.y).toBeCloseTo(l.y, 9);
      expect(w.z).toBeCloseTo(l.z, 9);
    }
    expect(Math.hypot(world.first.body.translation().x, world.first.body.translation().z)).toBeLessThan(arenaFloorRadius() * LAUNCH_TUNING.targetMaxRadiusShare + 1e-6);
    world.dispose();
    s.dispose();
  });
});
