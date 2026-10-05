// Owner, 2026-10-04: "Adicione um efeito visual de argola se expandindo no ar ao realizar o recovery." Through a real
// MatchSession: a launched Bey that presses Dodge in the air spawns the expanding rings, which grow, fade and go away.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { RECOVERY_RING_LIFE_S } from '../../src/vfx/RecoveryRing';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const DODGE: ControllerActions = { ...NONE, held: new Set([Action.Dodge]), pressedThisFrame: new Set([Action.Dodge]) };

function rings(root: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === 'airRecoveryRing') found.push(o);
  });
  return found;
}

describe('Air Recovery ring (owner, 2026-10-04)', () => {
  it('a recovery in the air spawns the rings at the Bey; they grow, fade and are removed', async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(camera);
    const PRESS_TICK = 45;
    const firstFrames = Array.from({ length: 120 }, (_, i) => (i === PRESS_TICK ? DODGE : NONE));
    const session = await MatchSession.create({
      scene,
      camera,
      seedText: 'recovery-ring',
      matchConfig: resolveMatchConfig(),
      attackProfileSettings: createDefaultAttackProfileSettings(),
      telemetry: new TelemetryRecorder(),
      stateMachine: new GameStateMachine(),
      controllers: { first: { kind: 'replay', label: 'first', frames: firstFrames }, second: { kind: 'replay', label: 'second', frames: firstFrames.map(() => NONE) } },
      keyboard: new IdleController(),
    });
    const root = session.getSceneRoot();
    for (let i = 0; i < 40; i++) session.tick();
    // Launched from the floor: 3 m up and armed as a knockback arms it (registerLaunch while still grounded).
    const bey = session.getBey('first');
    const p = bey.body.translation();
    bey.dodge.registerLaunch(false);
    bey.body.setTranslation({ x: p.x, y: p.y + 3, z: p.z }, true);
    for (let i = 40; i < PRESS_TICK; i++) session.tick();
    expect(rings(root)).toHaveLength(0);
    session.tick(); // the Dodge press: Air Recovery
    const at = bey.body.translation();
    const spawned = rings(root);
    expect(spawned, 'the main ring and its echo').toHaveLength(2);
    expect(spawned[0]!.position.distanceTo(new THREE.Vector3(at.x, at.y, at.z))).toBeLessThan(1);

    session.renderFrame(0.1, camera);
    const early = rings(root).filter((r) => r.visible);
    expect(early.length).toBeGreaterThan(0);
    const earlyScale = early[0]!.scale.x;
    session.renderFrame(0.15, camera);
    expect(rings(root)[0]!.scale.x, 'it expands').toBeGreaterThan(earlyScale);
    session.renderFrame(RECOVERY_RING_LIFE_S, camera);
    expect(rings(root), 'gone after its life').toHaveLength(0);
    session.dispose();
  });
});
