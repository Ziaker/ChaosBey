// The Debug Lab side of GDD 67/68: the live MatchSession runs the same
// anomaly detector as the Self-Test, and a scenario preset loaded into a
// live session plays out like it does headless.

import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import type { SideControllerSpec } from '../../src/app/session/SideControllers';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { buildInspection } from '../../src/debug/inspectors/buildInspection';
import { findScenarioPreset, type ScenarioSideScript } from '../../src/self-test/scenarios/ScenarioPresets';
import { TelemetryEventKind } from '../../src/telemetry/events/TelemetryEvent';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

async function createSession(controllers: { first: SideControllerSpec; second: SideControllerSpec }): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  return MatchSession.create({
    scene,
    camera,
    seedText: 'session-scenarios',
    matchConfig: resolveMatchConfig(),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers,
    keyboard: new IdleController(),
  });
}

const toSpec = (id: string, side: ScenarioSideScript): SideControllerSpec => (side.kind === 'script' ? { kind: 'scripted', label: id, frames: side.frames } : { kind: 'idle' });

describe('live session anomaly detection (GDD 67 in the Debug Lab)', () => {
  it('flags a Bey held inside the wall (an unknown invalid state since ext-32 was fixed), and records it in telemetry and the inspector', async () => {
    const session = await createSession({ first: { kind: 'idle' }, second: { kind: 'idle' } });
    for (let i = 0; i < 60; i++) {
      session.getBey('second').body.setTranslation({ x: ARENA_FLOOR_RADIUS + 0.1, y: 0.3, z: 0 }, true);
      session.getBey('second').body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      session.tick();
    }
    const found = session.getDetectedAnomalies().filter((d) => d.kind === 'stuck-in-wall');
    expect(found).toHaveLength(1);
    expect(found[0]!.knownIssue).toBeNull();
    expect(session.telemetry.getEvents().some((e) => e.kind === TelemetryEventKind.PhysicsAnomaly && e.anomalyKind === 'stuck-in-wall')).toBe(true);
    const match = buildInspection(session, { gameState: 't', fps: 0, frameTimeMs: 0, renderTimeMs: null, drawCalls: null, triangles: null, paused: true, ticksPerFixedStep: 1 })[0]!;
    expect(match.rows.find((r) => r.label === 'Anomalies (GDD 67)')?.value).toMatch(/stuck-in-wall$/);
    session.dispose();
  });

  it('a normal AI-vs-AI opening raises no invalid state', async () => {
    const session = await createSession({ first: { kind: 'ai', personality: 'archetype' }, second: { kind: 'ai', personality: 'archetype' } });
    for (let i = 0; i < 600; i++) session.tick();
    expect(session.getDetectedAnomalies().filter((d) => d.severity === 'invalid-state')).toEqual([]);
    session.dispose();
  });
});

describe('scenario presets in a live session (GDD 68 in the Debug Lab)', () => {
  it('the Clash preset starts a real Clash in the rendered pipeline', async () => {
    const preset = findScenarioPreset('clash')!;
    const session = await createSession({ first: toSpec(preset.id, preset.first), second: toSpec(preset.id, preset.second) });
    preset.setup!({ first: session.getBey('first'), second: session.getBey('second') });
    let started = false;
    for (let i = 0; i < preset.durationTicks && !started; i++) {
      session.tick();
      started = session.clash.controller.getState() === ClashState.Active;
    }
    expect(started).toBe(true);
    session.dispose();
  });
});
