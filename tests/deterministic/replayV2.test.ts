// M11 Replay V2: a player match driven by directional control records the
// resolved world direction (`move`) per frame and plays back with the same
// state hash on every tick; V1 files (no `move`) still decode and verify
// with the classic semantics.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import type { SideControllerSpec } from '../../src/app/session/SideControllers';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import { DirectionalController } from '../../src/input/directional/DirectionalController';
import { REPLAY_FORMAT, REPLAY_FORMAT_V1 } from '../../src/replay/contracts';
import { decodeReplay, encodeReplay, sealReplay, type ChaosBeyReplayV1 } from '../../src/replay/format/ChaosBeyReplayV1';
import { currentRuntimeFingerprint } from '../../src/replay/format/runtimeFingerprint';
import { playReplayHeadless } from '../../src/replay/playback/replayPlayback';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

/** Arrow keys held in a pattern (as a keyboard would report them), including diagonals and releases. */
class ArrowScript implements CombatController {
  private tick = 0;
  sampleActions(): ControllerActions {
    const t = this.tick++;
    const phase = Math.floor(t / 45) % 6;
    const keys: Action[][] = [[Action.MoveForward], [Action.MoveForward, Action.SteerRight], [], [Action.SteerLeft], [Action.MoveBackward], [Action.MoveBackward, Action.SteerLeft, Action.Attack]];
    const held = new Set(keys[phase]!);
    return { held, pressedThisFrame: t % 45 === 0 ? new Set(held) : new Set(), attackHoldDurationSeconds: held.has(Action.Attack) ? ((t % 45) + 1) / 60 : 0, jumpDriftHoldDurationSeconds: 0 };
  }
}

async function session(controllers: { first: SideControllerSpec; second: SideControllerSpec }, keyboard: CombatController): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  return MatchSession.create({
    scene,
    camera,
    seedText: 'm11-directional',
    matchConfig: resolveMatchConfig(),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers,
    keyboard,
  });
}

function decoded(text: string): ChaosBeyReplayV1 {
  const result = decodeReplay(text);
  if (!result.ok) throw new Error(`replay did not decode: ${JSON.stringify(result.errors.slice(0, 3))}`);
  return result.replay;
}

describe('Replay V2 (M11)', () => {
  it('a directional player match records `move` per frame and plays back verified on every tick', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    // A camera that keeps turning: the latch must still give a well-formed, reproducible command.
    let yaw = 0;
    const player = new DirectionalController(new ArrowScript(), { cameraYaw: () => (yaw += 0.01) });
    const live = await session({ first: { kind: 'keyboard' }, second: { kind: 'ai', personality: 'archetype' } }, player);
    live.startReplayCapture({ fingerprint, checkpointEvery: 1 });
    for (let i = 0; i < 900 && !live.roundState.isOver; i++) live.tick();
    const { replay } = live.finishReplayCapture();
    live.dispose();

    const text = encodeReplay(replay);
    const back = decoded(text);
    expect(back.format).toBe(REPLAY_FORMAT);
    expect(REPLAY_FORMAT).toBe('ChaosBeyReplayV2');
    const moves = back.frames.map((f) => f.first.move);
    expect(moves.every((m) => Array.isArray(m))).toBe(true); // every player frame is directional
    expect(moves.some((m) => m && Math.hypot(m[0], m[1]) > 0.99)).toBe(true);
    expect(back.frames.every((f) => f.second.move === null)).toBe(true); // the AI stays classic
    expect(back.frames.every((f) => !f.first.held.includes(Action.MoveForward) && !f.first.held.includes(Action.SteerLeft))).toBe(true);

    const verdict = await playReplayHeadless(back, fingerprint);
    expect(verdict).toMatchObject({ status: 'verified', ticksPlayed: back.frames.length });
  }, 180_000);

  it('a V1 file (classic player, no `move`) still decodes and verifies with the old semantics', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const classicPlayer = new DirectionalController(new ArrowScript(), { cameraYaw: () => 0 });
    classicPlayer.setEnabled(false);
    const live = await session({ first: { kind: 'keyboard' }, second: { kind: 'ai', personality: 'archetype' } }, classicPlayer);
    live.startReplayCapture({ fingerprint, checkpointEvery: 30 });
    for (let i = 0; i < 600 && !live.roundState.isOver; i++) live.tick();
    const { replay } = live.finishReplayCapture();
    live.dispose();
    expect(replay.frames.some((f) => f.first.held.includes(Action.SteerLeft))).toBe(true);

    // Rewrite it exactly as an M9/M10 build wrote it: format V1, no `move` keys.
    const raw = JSON.parse(encodeReplay(replay));
    raw.format = REPLAY_FORMAT_V1;
    for (const frame of raw.frames) {
      delete frame.first.move;
      delete frame.second.move;
    }
    const { integrity: _old, ...unsealed } = raw;
    const v1 = decoded(JSON.stringify(sealReplay(unsealed)));
    expect(v1.format).toBe(REPLAY_FORMAT_V1);
    expect(await playReplayHeadless(v1, fingerprint)).toMatchObject({ status: 'verified', ticksPlayed: v1.frames.length });

    // A V1 file must not carry `move`, and a V2 file must.
    const badV1 = JSON.parse(JSON.stringify(unsealed));
    badV1.frames[0].first.move = [0, 1];
    const badResult = decodeReplay(JSON.stringify(sealReplay(badV1)));
    expect(badResult.ok).toBe(false);
    const badV2 = JSON.parse(encodeReplay(replay));
    delete badV2.frames[0].first.move;
    const { integrity: _i, ...badV2Unsealed } = badV2;
    const badV2Result = decodeReplay(JSON.stringify(sealReplay(badV2Unsealed)));
    expect(badV2Result.ok).toBe(false);
    if (!badV2Result.ok) expect(badV2Result.errors.map((e) => `${e.code} @ ${e.path}`)).toContain('missing-field @ frames[0].first.move');
  }, 180_000);

  it('rejects a `move` longer than 1 or not a pair', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const live = await session({ first: { kind: 'keyboard' }, second: { kind: 'idle' } }, new DirectionalController(new ArrowScript(), { cameraYaw: () => 0 }));
    live.startReplayCapture({ fingerprint, checkpointEvery: 10 });
    for (let i = 0; i < 20; i++) live.tick();
    const { replay } = live.finishReplayCapture();
    live.dispose();
    for (const [move, reason] of [
      [[1, 1], 'length'],
      [[1], 'pair'],
      ['up', 'pair'],
    ] as const) {
      const raw = JSON.parse(encodeReplay(replay));
      raw.frames[3].first.move = move;
      const { integrity: _o, ...unsealed } = raw;
      const result = decodeReplay(JSON.stringify(sealReplay(unsealed)));
      expect(result.ok, reason).toBe(false);
      if (!result.ok) expect(result.errors.some((e) => e.path === 'frames[3].first.move')).toBe(true);
    }
  }, 60_000);
});
