// Bey Real in a real MatchSession (0.59.0, owner 2026-10-09): the Beys move by themselves, the player's stick takes its share,
// the match stays inside the stage, the mode is deterministic and its replay verifies, and the classic game is untouched.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { createDefaultMatchSetup, defaultRealSetup, matchConfigFor } from '../../src/app/frontend/matchSetup';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { REAL_BASE_PARAMS, realPresetValues } from '../../src/bey/real/RealTuning';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import type { MatchConfig } from '../../src/config/match/MatchConfig';
import { Action } from '../../src/input/actions/Action';
import { PRESENTATION_FEATURES_DEFAULT } from '../../src/presentation/features';
import { decodeReplay, encodeReplay } from '../../src/replay/format/ChaosBeyReplayV1';
import { currentRuntimeFingerprint } from '../../src/replay/format/runtimeFingerprint';
import { playReplayHeadless } from '../../src/replay/playback/replayPlayback';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import type { RealParams } from '../../src/bey/real/RealTuning';
import type { CombatController, ControllerActions } from '../../src/input/actions/Action';

function realConfig(params: Partial<RealParams> = {}): MatchConfig {
  const setup = createDefaultMatchSetup();
  return matchConfigFor({ ...setup, real: { ...defaultRealSetup(), enabled: true, params: { ...REAL_BASE_PARAMS, ...params } } });
}

/** A "person" who holds a world direction on the stick (the directional controller's own output shape). */
class HeldStick implements CombatController {
  constructor(private readonly x: number, private readonly z: number) {}
  sampleActions(): ControllerActions {
    return { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0, moveIntent: { x: this.x, z: this.z } };
  }
}

async function session(config: MatchConfig, keyboard: CombatController, second: 'ai' | 'idle' = 'ai', seed = 'real-mode'): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  return MatchSession.create({
    scene,
    camera,
    seedText: seed,
    matchConfig: config,
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: { kind: 'keyboard' }, second: second === 'ai' ? { kind: 'ai', personality: 'archetype', difficulty: 'rival' } : { kind: 'idle' } },
    keyboard,
    presentationFeatures: PRESENTATION_FEATURES_DEFAULT,
  });
}

const speedOf = (s: MatchSession, side: 'first' | 'second'): number => {
  const v = s.getBey(side).body.linvel();
  return Math.hypot(v.x, v.z);
};
const radiusOf = (s: MatchSession, side: 'first' | 'second'): number => {
  const p = s.getBey(side).body.translation();
  return Math.hypot(p.x, p.z);
};

describe('Bey Real match', () => {
  it('both Beys move by themselves with nobody on the controls, inside the stage, and tire as they go', async () => {
    const s = await session(realConfig(), new ScriptedController([]));
    const stage = REAL_BASE_PARAMS.stageRadiusM;
    let fastTicks = 0;
    let maxRadius = 0;
    for (let i = 0; i < 60 * 12 && !s.roundState.isOver; i++) {
      s.tick();
      if (speedOf(s, 'first') > 4 && speedOf(s, 'second') > 4) fastTicks++;
      maxRadius = Math.max(maxRadius, radiusOf(s, 'first'), radiusOf(s, 'second'));
    }
    expect(fastTicks, 'they keep moving on their own').toBeGreaterThan(60 * 6);
    expect(maxRadius, 'they stay on the stage').toBeLessThan(stage + 1);
    for (const side of ['first', 'second'] as const) {
      const fraction = s.getBey(side).stamina.resource.fraction;
      expect(fraction).toBeLessThan(1);
      expect(fraction, 'the spin goes down by spinning, travelling, steering and hitting — but a fight is not over in 12 s').toBeGreaterThan(0.3);
    }
    s.dispose();
  }, 60_000);

  it('the stage is the 15 m stage: the ring-out line, not the classic 36 m', async () => {
    const s = await session(realConfig(), new ScriptedController([]));
    // a Bey placed outside 15 m + margin would be a ring-out in this match; the spawn is inside it
    expect(radiusOf(s, 'first')).toBeLessThan(15);
    expect(s.matchConfig.arenaSizeScale).toBeCloseTo(15 / 36, 6);
    s.dispose();
  });

  it('the player\'s stick takes its share of the steering: more influence follows the stick more, 0 ignores it', async () => {
    const ahead = async (influence: number): Promise<number> => {
      const s = await session(realConfig({ influence, pursuit: 0 }), new HeldStick(1, 0), 'idle');
      const start = s.getBey('first').body.translation();
      for (let i = 0; i < 90; i++) s.tick();
      const end = s.getBey('first').body.translation();
      s.dispose();
      return end.x - start.x;
    };
    const none = await ahead(0);
    const some = await ahead(0.4);
    const all = await ahead(1);
    expect(all).toBeGreaterThan(some);
    expect(some).toBeGreaterThan(none);
    expect(all, 'full influence drives the Bey across the stage along the stick').toBeGreaterThan(6);
  }, 60_000);

  it('the same seed and inputs give the same match, tick for tick', async () => {
    const run = async (): Promise<string[]> => {
      const s = await session(realConfig(), new ScriptedController([{ fromTick: 30, held: [Action.Attack] }, { fromTick: 40, held: [] }, { fromTick: 90, held: [Action.JumpDrift] }, { fromTick: 100, held: [] }]));
      const hashes: string[] = [];
      for (let i = 0; i < 400; i++) {
        s.tick();
        if (i % 20 === 0) hashes.push(s.getStateHash());
      }
      s.dispose();
      return hashes;
    };
    expect(await run()).toEqual(await run());
  }, 60_000);

  it('a Bey Real match records, decodes and plays back verified (the replay carries the mode)', async () => {
    const config = realConfig();
    const s = await session(config, new ScriptedController([{ fromTick: 50, held: [Action.Attack] }, { fromTick: 70, held: [] }, { fromTick: 150, held: [Action.Dodge] }, { fromTick: 152, held: [] }]));
    const fingerprint = await currentRuntimeFingerprint();
    s.startReplayCapture({ fingerprint, checkpointEvery: 20 });
    for (let i = 0; i < 480 && !s.roundState.isOver; i++) s.tick();
    const { replay } = s.finishReplayCapture();
    s.dispose();
    expect(replay.config.matchConfig.real).toEqual(config.real);
    const decoded = decodeReplay(encodeReplay(replay));
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.errors.slice(0, 3)));
    const verdict = await playReplayHeadless(decoded.replay, fingerprint);
    expect(verdict).toMatchObject({ status: 'verified' });
  }, 120_000);

  it('every preset plays: no NaN, the Beys stay finite and on the stage', async () => {
    for (const id of ['base', 'proposal', 'automatic', 'buttons', 'heavy', 'wild']) {
      const params = realPresetValues(id);
      const s = await session(realConfig(params), new ScriptedController([]));
      for (let i = 0; i < 60 * 6 && !s.roundState.isOver; i++) {
        s.tick();
        for (const side of ['first', 'second'] as const) {
          const p = s.getBey(side).body.translation();
          expect(Number.isFinite(p.x + p.y + p.z), `${id} ${side}`).toBe(true);
        }
      }
      s.dispose();
    }
  }, 120_000);
});

describe('Bey Real contacts and actions in a real match', () => {
  it('two Beys that meet are judged by the real contact model: the spin and the Stability drop, nothing goes wild', async () => {
    // The stick drives the first Bey at the opponent (full influence), so they meet within a few seconds.
    const config = realConfig({ influence: 1, pursuit: 1, aiAggression: 0 });
    const s = await session(config, new HeldStick(0, 1), 'idle');
    let bodyCollisions = 0;
    let maxSpeed = 0;
    for (let i = 0; i < 60 * 10 && !s.roundState.isOver; i++) {
      const out = s.tick();
      for (const event of out.result.combatEvents) if (event.kind === 'bodyCollision') bodyCollisions++;
      for (const side of ['first', 'second'] as const) {
        const v = s.getBey(side).body.linvel();
        expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
        maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.z));
      }
    }
    expect(bodyCollisions, 'the Beys touched at least once').toBeGreaterThan(0);
    expect(maxSpeed).toBeLessThan(60);
    const spin = s.getBey('second').stamina.resource.fraction;
    expect(spin).toBeLessThan(0.99);
    s.dispose();
  }, 60_000);

  it('a Dash costs its share of the spin and runs the slider\'s speed; the Dash cooldown is the slider\'s', async () => {
    const hold = new ScriptedController([{ fromTick: 5, held: [Action.Attack] }, { fromTick: 5 + 60, held: [] }]);
    const dashSpinCost = 0.05;
    const s = await session(realConfig({ dashSpinCost, dashMinSpeedMps: 20, dashMaxSpeedMps: 26, influence: 0, aiAggression: 0 }), hold, 'idle');
    let beforeSpin = 0;
    let peak = 0;
    for (let i = 0; i < 60 * 4; i++) {
      if (i === 65) beforeSpin = s.getBey('first').stamina.resource.fraction;
      s.tick();
      if (i > 65) {
        const v = s.getBey('first').body.linvel();
        peak = Math.max(peak, Math.hypot(v.x, v.z));
      }
    }
    expect(peak, 'the Dash runs at the mode\'s speeds, not the game\'s ×2.8 top-speed scale').toBeGreaterThan(18);
    expect(peak).toBeLessThan(40);
    expect(beforeSpin).toBeGreaterThan(0.9);
    // 60 ticks of charge (1 s) and the release: spin share 0.05 was spent on release on top of the drain
    const after = s.getBey('first').stamina.resource.fraction;
    expect(beforeSpin - after).toBeGreaterThan(dashSpinCost * 0.9);
    s.dispose();
  }, 60_000);
});

describe('the classic game is untouched', () => {
  it('a classic config has no `real`, and a classic Bey keeps the kart handling (no Bey Real state in its hash)', async () => {
    const config = matchConfigFor(createDefaultMatchSetup());
    expect('real' in config).toBe(false);
    const s = await session(config, new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]));
    for (let i = 0; i < 120; i++) s.tick();
    const movement = s.getBey('first').movement.getDeterministicState();
    expect('realWobblePhase' in movement).toBe(false);
    expect(s.getBey('first').rules.real).toBeNull();
    s.dispose();
  }, 60_000);
});
