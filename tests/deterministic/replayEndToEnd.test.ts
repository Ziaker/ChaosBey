// M9 lane C integration: record through the real tick callers, write the
// ChaosBeyReplayV1 file, read it back, rebuild the match from the file's
// own config and play it through the same simulation (headless and live),
// checking every stored state hash. Plus refusal of incompatible replays
// and detection of tampered ones.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import type { SideControllerSpec } from '../../src/app/session/SideControllers';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { Action } from '../../src/input/actions/Action';
import type { RuntimeFingerprint } from '../../src/replay/contracts';
import { decodeReplay, encodeReplay, sealReplay, type ChaosBeyReplayV1 } from '../../src/replay/format/ChaosBeyReplayV1';
import { currentRuntimeFingerprint } from '../../src/replay/format/runtimeFingerprint';
import { checkReplayCompatibility, framesFromReplay, playReplayHeadless } from '../../src/replay/playback/replayPlayback';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { runScenario } from '../../src/self-test/scenarios/ScenarioRunner';
import { SCENARIO_PRESETS } from '../../src/self-test/scenarios/ScenarioPresets';
import { setResourceFraction } from '../../src/debug/cheats/DebugMutations';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

// A long fight with many hitstop freezes (see replayPlayback.test.ts, whose
// header comment explains this seed's re-pinning history).
// Re-pinned in the arena scale pass: see the seed notes in replayPlayback.test.ts.
// Re-pinned with replayPlayback.test.ts (ring-out delay, Perfect Dodge once, Dash cooldown, momentum; owner 2026-10-02).
const LONG_SEED = 'replay-198';
/** The tampered-inputs check flips MoveForward on ticks 300 up to (not including) this. */
const EDIT_END_TICK = 700;

async function liveSession(seedText: string, controllers: { first: SideControllerSpec; second: SideControllerSpec }, replay?: ChaosBeyReplayV1): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  return MatchSession.create({
    scene,
    camera,
    seedText,
    matchConfig: replay ? replay.config.matchConfig : resolveMatchConfig(),
    attackProfileSettings: replay ? replay.config.attackProfileSettings : createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers,
    keyboard: new IdleController(),
  });
}

/** Records a live AI-vs-AI match through MatchSession's hook and returns the file text as a player would save it. */
async function recordLiveFile(seed: string, fingerprint: RuntimeFingerprint, checkpointEvery = 1): Promise<{ text: string; frozenTicks: number; hashes: string[] }> {
  const live = await liveSession(seed, { first: { kind: 'ai', personality: 'archetype' }, second: { kind: 'ai', personality: 'archetype' } });
  live.startReplayCapture({ fingerprint, checkpointEvery });
  const hashes = [live.getStateHash()];
  let frozenTicks = 0;
  for (let i = 0; i < 3600 && !live.roundState.isOver; i++) {
    if (!live.tick().simulationAdvanced) frozenTicks++;
    hashes.push(live.getStateHash());
  }
  const { replay, debugMutations } = live.finishReplayCapture();
  expect(debugMutations).toEqual([]);
  live.dispose();
  return { text: encodeReplay(replay), frozenTicks, hashes };
}

function decoded(text: string): ChaosBeyReplayV1 {
  const result = decodeReplay(text);
  if (!result.ok) throw new Error(`replay did not decode: ${JSON.stringify(result.errors.slice(0, 3))}`);
  return result.replay;
}

function reseal(replay: ChaosBeyReplayV1, edit: (raw: any) => void): ChaosBeyReplayV1 {
  const raw = JSON.parse(encodeReplay(replay));
  edit(raw);
  const { integrity: _old, ...unsealed } = raw;
  return decoded(JSON.stringify(sealReplay(unsealed)));
}

describe('record → file → playback (M9)', () => {
  it('live AI-vs-AI → file → headless: every per-tick checkpoint reproduced, hitstop freezes included', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const { text, frozenTicks, hashes } = await recordLiveFile(LONG_SEED, fingerprint);
    expect(frozenTicks).toBeGreaterThan(100);
    const replay = decoded(text);
    expect(replay.frames.length).toBeGreaterThan(1000);
    // The checkpoints the hook stored are the live session's own state hashes.
    expect(replay.checkpoints.map((c) => c.hash)).toEqual(hashes);

    const verdict = await playReplayHeadless(replay, fingerprint);
    expect(verdict).toMatchObject({ status: 'verified', ticksPlayed: replay.frames.length, comparison: { status: 'match', compared: replay.frames.length + 1 } });
  }, 180_000);

  it('live AI-vs-AI → file → live MatchSession (replay controllers): identical hash on every tick', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const replay = decoded((await recordLiveFile(LONG_SEED, fingerprint)).text);
    const compatibility = checkReplayCompatibility(replay, fingerprint);
    expect(compatibility.ok).toBe(true);
    if (!compatibility.ok) return;
    // A live session builds the Attack vs Defense match; the replay must be that match.
    expect([compatibility.beys.first.id, compatibility.beys.second.id]).toEqual([ATTACK_ARCHETYPE.id, DEFENSE_ARCHETYPE.id]);

    const frames = framesFromReplay(replay);
    const playback = await liveSession(replay.config.seedText, { first: { kind: 'replay', label: 'first', frames: frames.first }, second: { kind: 'replay', label: 'second', frames: frames.second } }, replay);
    const expected = new Map(replay.checkpoints.map((c) => [c.ticksCompleted, c.hash]));
    expect(playback.getStateHash()).toBe(expected.get(0));
    for (let n = 1; n <= replay.frames.length; n++) {
      playback.tick();
      expect(playback.getStateHash(), `ticksCompleted ${n}`).toBe(expected.get(n));
    }
    playback.dispose();
  }, 180_000);

  it('a headless AI batch match records through its hook and plays back verified, with sparse checkpoints too', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    for (const checkpointEvery of [1, 60]) {
      const record = await simulateAiMatch({
        seed: 'batch-record',
        firstDefinition: STAMINA_ARCHETYPE,
        secondDefinition: ATTACK_ARCHETYPE,
        maxTicks: 1500,
        record: { fingerprint, checkpointEvery },
      });
      const replay = decoded(encodeReplay(record.replay!));
      expect(replay.frames.length).toBe(record.stats.ticks);
      // The final state is always checkpointed.
      expect(replay.checkpoints.at(-1)?.ticksCompleted).toBe(record.stats.ticks);
      const verdict = await playReplayHeadless(replay, fingerprint);
      expect(verdict.status).toBe('verified');
    }
  }, 180_000);

  it('a scenario records after its setup; playback reproduces it only with the same setup re-applied', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const preset = SCENARIO_PRESETS.find((p) => p.supported && p.setup !== undefined);
    expect(preset).toBeDefined();
    const result = await runScenario(preset!, { record: { fingerprint } });
    expect(result.status).toBe('passed');
    const replay = decoded(encodeReplay(result.replay!));

    expect((await playReplayHeadless(replay, fingerprint, { setup: preset!.setup })).status).toBe('verified');
    // Without the setup, the initial state already differs: caught at TicksCompleted 0.
    expect(await playReplayHeadless(replay, fingerprint)).toMatchObject({ status: 'diverged', comparison: { lastMatch: null, firstMismatch: { ticksCompleted: 0 } } });
  }, 120_000);
});

describe('incompatible and tampered replays', () => {
  it('refuses a replay from another build (fingerprint), unless explicitly allowed for diagnosis', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const record = await simulateAiMatch({ seed: 'fp', firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 300, record: { fingerprint } });
    const replay = record.replay!;
    const otherBuild: RuntimeFingerprint = { ...fingerprint, commit: 'deadbeef', rapierVersion: '0.20.0' };
    const refused = await playReplayHeadless(replay, otherBuild);
    expect(refused.status).toBe('refused');
    if (refused.status === 'refused') expect(refused.refusals).toEqual([{ code: 'fingerprint-mismatch', mismatches: expect.arrayContaining([expect.objectContaining({ field: 'commit' }), expect.objectContaining({ field: 'rapierVersion' })]) }]);
    const allowed = await playReplayHeadless(replay, otherBuild, { allowFingerprintMismatch: true });
    expect(allowed).toMatchObject({ status: 'verified', fingerprintMismatches: [{ field: 'commit' }, { field: 'rapierVersion' }] });
  }, 60_000);

  it('refuses a replay whose Bey this build does not have, or has with different gameplay', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const replay = (await simulateAiMatch({ seed: 'beys', firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 60, record: { fingerprint } })).replay!;
    const unknown = reseal(replay, (r) => (r.config.beys.first.definitionId = 'prototype-that-never-existed'));
    expect(await playReplayHeadless(unknown, fingerprint)).toEqual({ status: 'refused', refusals: [{ code: 'unknown-bey', side: 'first', definitionId: 'prototype-that-never-existed' }] });
    const edited = reseal(replay, (r) => (r.config.beys.second.definitionDigest = '0123456789abcdef'));
    expect(await playReplayHeadless(edited, fingerprint)).toEqual({ status: 'refused', refusals: [{ code: 'bey-digest-mismatch', side: 'second', definitionId: DEFENSE_ARCHETYPE.id }] });
  }, 60_000);

  it('a hand-edited file is refused at decode (integrity); one re-sealed after editing inputs diverges in playback', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const text = (await recordLiveFile(LONG_SEED, fingerprint)).text;
    const raw = JSON.parse(text);
    raw.frames[300].first.held = ['Dodge'];
    const edited = decodeReplay(JSON.stringify(raw));
    expect(edited.ok).toBe(false);
    if (!edited.ok) expect(edited.errors.map((e) => e.code)).toEqual(['integrity-mismatch']);

    // Re-sealed: the file is valid, but its inputs no longer produce its states.
    // Flipping MoveForward on ticks 300..699 is certain to reach ticks where movement is read
    // (400 ticks: a Clash or a hitstop can hold movement for a long stretch).
    const replay = decoded(text);
    const tampered = reseal(replay, (r) => {
      for (let n = 300; n < EDIT_END_TICK; n++) {
        const held: string[] = r.frames[n].first.held;
        r.frames[n].first.held = (held.includes(Action.MoveForward) ? held.filter((a) => a !== Action.MoveForward) : [...held, Action.MoveForward]).sort();
      }
    });
    const verdict = await playReplayHeadless(tampered, fingerprint);
    expect(verdict.status).toBe('diverged');
    if (verdict.status !== 'diverged' || verdict.comparison.status !== 'diverged') return;
    expect(verdict.comparison.lastMatch).toBeGreaterThanOrEqual(300);
    expect(verdict.comparison.firstMismatch.ticksCompleted).toBeGreaterThan(300);
    expect(verdict.comparison.firstMismatch.ticksCompleted).toBeLessThanOrEqual(EDIT_END_TICK);
    // Per-tick checkpoints: the window is exactly one tick.
    expect(verdict.comparison.firstMismatch.ticksCompleted).toBe(verdict.comparison.lastMatch! + 1);
  }, 180_000);

  it('never calls a replay verified without its initial and final checkpoints (re-sealed files)', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const replay = (await simulateAiMatch({ seed: 'bounds', firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 300, record: { fingerprint, checkpointEvery: 60 } })).replay!;
    const last = replay.frames.length;
    expect((await playReplayHeadless(replay, fingerprint)).status).toBe('verified');

    const cases: [string, (r: any) => void, number[]][] = [
      ['no checkpoints', (r) => (r.checkpoints = []), [0, last]],
      ['only the initial checkpoint', (r) => (r.checkpoints = r.checkpoints.slice(0, 1)), [last]],
      ['no final checkpoint', (r) => (r.checkpoints = r.checkpoints.filter((c: any) => c.ticksCompleted !== last)), [last]],
      ['no initial checkpoint', (r) => (r.checkpoints = r.checkpoints.filter((c: any) => c.ticksCompleted !== 0)), [0]],
    ];
    for (const [label, edit, missing] of cases) {
      const verdict = await playReplayHeadless(reseal(replay, edit), fingerprint);
      expect(verdict, label).toEqual({ status: 'refused', refusals: [{ code: 'missing-boundary-checkpoint', missing }] });
      // The live path goes through the same check.
      expect(checkReplayCompatibility(reseal(replay, edit), fingerprint).ok, label).toBe(false);
    }
    // Sparse intermediate checkpoints stay fine: keep only the two boundaries.
    const boundariesOnly = reseal(replay, (r) => (r.checkpoints = r.checkpoints.filter((c: any) => c.ticksCompleted === 0 || c.ticksCompleted === last)));
    expect(boundariesOnly.checkpoints.length).toBe(2);
    expect((await playReplayHeadless(boundariesOnly, fingerprint)).status).toBe('verified');
  }, 60_000);

  it('a re-sealed file with an altered checkpoint is caught at exactly that checkpoint', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const replay = (await simulateAiMatch({ seed: 'cp', firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 600, record: { fingerprint } })).replay!;
    const mid = Math.floor(replay.frames.length / 2);
    expect(mid).toBeGreaterThan(20);
    // Per-tick checkpoints: checkpoints[n] is the state at TicksCompleted n.
    expect(replay.checkpoints[mid]!.ticksCompleted).toBe(mid);
    const tampered = reseal(replay, (r) => (r.checkpoints[mid].hash = r.checkpoints[mid].hash === '0000000000000000' ? '0000000000000001' : '0000000000000000'));
    expect(await playReplayHeadless(tampered, fingerprint)).toMatchObject({ status: 'diverged', comparison: { lastMatch: mid - 1, firstMismatch: { ticksCompleted: mid } } });
  }, 60_000);

  it('Debug Lab state edits during a recording are reported, and such a replay diverges where they happened', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const live = await liveSession(LONG_SEED, { first: { kind: 'ai', personality: 'archetype' }, second: { kind: 'ai', personality: 'archetype' } });
    live.startReplayCapture({ fingerprint });
    for (let i = 0; i < 120; i++) live.tick();
    setResourceFraction(live, 'second', 'stability', 0.1);
    for (let i = 0; i < 60 && !live.roundState.isOver; i++) live.tick();
    const { replay, debugMutations } = live.finishReplayCapture();
    live.dispose();
    expect(debugMutations.map((m) => m.tickIndex)).toEqual([120]);
    expect(await playReplayHeadless(replay, fingerprint)).toMatchObject({ status: 'diverged', comparison: { lastMatch: 120, firstMismatch: { ticksCompleted: 121 } } });
  }, 60_000);

  it('Debug Lab forced inputs are not state edits: they are in the frames, so the replay still verifies', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const live = await liveSession(LONG_SEED, { first: { kind: 'ai', personality: 'archetype' }, second: { kind: 'ai', personality: 'archetype' } });
    live.startReplayCapture({ fingerprint });
    for (let i = 0; i < 90; i++) live.tick();
    live.forceInput('first', 'dash', [{ fromTick: 0, held: [Action.Attack] }], 30);
    for (let i = 0; i < 120 && !live.roundState.isOver; i++) live.tick();
    const { replay, debugMutations } = live.finishReplayCapture();
    expect(live.getDebugMutations().length).toBe(1);
    live.dispose();
    expect(debugMutations).toEqual([]);
    expect((await playReplayHeadless(replay, fingerprint)).status).toBe('verified');
  }, 60_000);

  it('recording can only start before the first tick', async () => {
    const live = await liveSession('late-start', { first: { kind: 'idle' }, second: { kind: 'idle' } });
    live.tick();
    expect(() => live.startReplayCapture({ fingerprint: { buildVersion: 'test', commit: null, rapierVersion: 'x' } })).toThrow(/before the first tick/);
    live.dispose();
  });
});
