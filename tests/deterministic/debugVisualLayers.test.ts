// Debug Lab visualization layers (GDD sections 70, 71) on a real session.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession, type Side } from '../../src/app/session/MatchSession';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { DEBUG_LAYERS, DebugVisualLayers, type DebugLayerId } from '../../src/debug/visualization/DebugVisualLayers';
import { ARENA_WALL_SEGMENT_COUNT } from '../../src/arena/colliders/ArenaTuning';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

async function createSession(seedText: string): Promise<{ session: MatchSession; scene: THREE.Scene; camera: THREE.PerspectiveCamera }> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  scene.add(camera);
  const session = await MatchSession.create({
    scene,
    camera,
    seedText,
    matchConfig: resolveMatchConfig(),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: { kind: 'ai', personality: 'attack' }, second: { kind: 'ai', personality: 'archetype' } },
    keyboard: new IdleController(),
  });
  return { session, scene, camera };
}

function fingerprint(session: MatchSession): number[] {
  const values: number[] = [];
  for (const side of ['first', 'second'] as Side[]) {
    const bey = session.getBey(side);
    const t = bey.body.translation();
    const v = bey.body.linvel();
    values.push(t.x, t.y, t.z, v.x, v.y, v.z, bey.stability.resource.value);
  }
  return values;
}

function allFinite(root: THREE.Object3D): boolean {
  let ok = true;
  root.traverse((object) => {
    for (const n of [object.position.x, object.position.y, object.position.z, object.quaternion.x, object.quaternion.w, object.scale.x]) {
      if (!Number.isFinite(n)) ok = false;
    }
  });
  return ok;
}

const ALL_LAYERS: DebugLayerId[] = DEBUG_LAYERS.map((l) => l.id);

describe('DebugVisualLayers', () => {
  it('draws every collider: both Beys (body + Bey-Bey bumper each, M11), the floor and every wall segment', async () => {
    const { session } = await createSession('viz-colliders');
    const layers = new DebugVisualLayers(session, ['colliders']);
    layers.update();
    expect(layers.countVisibleObjects('colliders')).toBe(2 * 2 + 1 + ARENA_WALL_SEGMENT_COUNT);
    layers.setEnabled('colliders', false);
    expect(layers.countVisibleObjects('colliders')).toBe(0);
    session.dispose();
  });

  it('follows a real AI-vs-AI fight: hitboxes, lock-on, knockback and contacts all appear, and every drawing stays finite', async () => {
    const { session } = await createSession('viz-fight');
    const layers = new DebugVisualLayers(session, ALL_LAYERS);
    const seen = new Set<DebugLayerId>();
    for (let i = 0; i < 2400; i++) {
      session.tick();
      layers.update();
      for (const id of ['hitboxes', 'lockOn', 'forces', 'contacts', 'targetPath', 'velocity', 'angular', 'ringOut'] as DebugLayerId[]) {
        if (layers.countVisibleObjects(id) > 0) seen.add(id);
      }
      if (i % 60 === 0) expect(allFinite(session.getSceneRoot())).toBe(true);
    }
    for (const id of ['hitboxes', 'lockOn', 'forces', 'contacts', 'targetPath', 'velocity', 'angular', 'ringOut'] as DebugLayerId[]) {
      expect(seen.has(id), id).toBe(true);
    }
    session.dispose();
  });

  it('drawing never changes the simulation', async () => {
    const drawn = await createSession('viz-no-side-effects');
    const plain = await createSession('viz-no-side-effects');
    const layers = new DebugVisualLayers(drawn.session, ALL_LAYERS);
    for (let i = 0; i < 600; i++) {
      drawn.session.tick();
      plain.session.tick();
      layers.update();
    }
    expect(fingerprint(drawn.session)).toEqual(fingerprint(plain.session));
    drawn.session.dispose();
    plain.session.dispose();
  });

  it('dispose() removes the layers from the scene', async () => {
    const { session } = await createSession('viz-dispose');
    const layers = new DebugVisualLayers(session, ALL_LAYERS);
    const before = session.getSceneRoot().children.length;
    layers.dispose();
    expect(session.getSceneRoot().children.length).toBe(before - 1);
    session.dispose();
  });
});

describe('render-only presentation toggles', () => {
  it('overview camera and camera-effects-off change only the camera, never the simulation', async () => {
    const { session, camera } = await createSession('presentation');
    for (let i = 0; i < 120; i++) session.tick();
    const before = fingerprint(session);

    session.renderFrame(1 / 60, camera, { cameraView: 'overview', cameraEffects: true });
    expect(camera.position.y).toBeGreaterThan(20);

    session.renderFrame(1 / 60, camera, { cameraView: 'game', cameraEffects: false });
    // Effects off: the director's FOV without the impact punch (M11 camera).
    const output = session.getLastCameraOutput()!;
    expect(camera.fov).toBe(output.fovDeg - output.fovPunchDeg);
    const focus = session.getLastCameraOutput()!.cameraPositionM;
    expect(camera.position.x).toBeCloseTo(focus.x, 9);
    expect(camera.position.y).toBeCloseTo(focus.y, 9);

    expect(fingerprint(session)).toEqual(before);
    session.dispose();
  });

  it('VFX layers hide and show without stopping the effects themselves', async () => {
    const { session } = await createSession('vfx-layers');
    const vfx = session.getVfxManager();
    vfx.setLayerVisible('trails', false);
    vfx.setLayerVisible('speedLines', false);
    vfx.setLayerVisible('impactBursts', false);
    expect(vfx.isLayerVisible('trails')).toBe(false);
    let hiddenBurstSeen = false;
    for (let i = 0; i < 2400 && !hiddenBurstSeen; i++) {
      session.tick();
      session.renderFrame(1 / 60, new THREE.PerspectiveCamera());
      session.getSceneRoot().traverse((object) => {
        if ((object as THREE.Points).isPoints && !object.visible && object.parent === session.getSceneRoot()) hiddenBurstSeen = true;
      });
    }
    expect(hiddenBurstSeen).toBe(true);
    vfx.setLayerVisible('impactBursts', true);
    expect(vfx.isLayerVisible('impactBursts')).toBe(true);
    session.dispose();
  });
});
