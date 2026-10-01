// ============================================================
// PRESENTATION FOUNDATION: BEHAVIOUR NEUTRALITY ON A REAL MATCH SESSION
// The foundation must not change what a match does. These tests run the
// real session (real Rapier, real AI, real camera director) in three
// configurations and require the identical simulation:
//   A. defaults (every presentation flag off, nothing attached);
//   B. every flag on;
//   C. every flag on, plus attached systems that listen to every event, read
//      every anchor and add and remove scene objects.
// The canonical state hash on every tick, the replay file's integrity hash
// and the camera output must match across all three. They also prove the
// lifecycle on a real session: dispose releases attached systems, nothing
// leaks between sessions, a reset clears running effects, and an arena theme
// never reaches a collider.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { createArenaColliders } from '../../src/arena/colliders/createArenaColliders';
import { FOUNDRY_PIT, RIFT_CRATER, TOURNAMENT_STADIUM } from '../../src/arena/presets/ArenaPresets';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import {
  PRESENTATION_FEATURES_OFF,
  VfxDirector,
  collectSceneStats,
  resolvePresentationFeatures,
  type MatchPresentationState,
  type PresentationEvent,
  type PresentationFeatures,
  type PresentationSystem,
  type VfxEffect,
} from '../../src/presentation';

const ALL_ON: PresentationFeatures = resolvePresentationFeatures({ newBeyVisuals: true, conditionVisuals: true, hybridVfx: true, clashPresentation: true, newHud: true, arenaVisuals: true });
const SEED = 'presentation-neutrality-1';
const TICKS = 900;
const FINGERPRINT = { buildVersion: 'test', commit: null, rapierVersion: 'test' } as const;

async function createSession(features: PresentationFeatures | undefined, seed = SEED) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  scene.add(camera);
  const session = await MatchSession.create({
    scene,
    camera,
    seedText: seed,
    matchConfig: resolveMatchConfig(),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: { kind: 'ai', personality: 'archetype' }, second: { kind: 'ai', personality: 'archetype' } },
    keyboard: new IdleController(),
    ...(features ? { presentationFeatures: features } : {}),
  });
  return { session, scene, camera };
}

class Recorder implements PresentationSystem {
  readonly id = 'recorder';
  readonly events: PresentationEvent[] = [];
  readonly states: MatchPresentationState[] = [];
  created = 0;
  disposed = 0;
  resets = 0;
  frames = 0;
  create(): void {
    this.created++;
  }
  onEvents(events: readonly PresentationEvent[], state: MatchPresentationState): void {
    this.events.push(...events);
    this.states.push(state);
  }
  update(): void {
    this.frames++;
  }
  reset(): void {
    this.resets++;
  }
  dispose(): void {
    this.disposed++;
  }
}

/** An effect that, on every hit or collision, puts a mesh at a Bey anchor into the session scene, and takes it out on reset / dispose. */
function sceneEffect(root: THREE.Object3D, readAnchor: (name: string, out: { x: number; y: number; z: number }) => boolean): VfxEffect & { alive: () => number } {
  const meshes: THREE.Mesh[] = [];
  const out = { x: 0, y: 0, z: 0 };
  const clear = (): void => {
    for (const mesh of meshes.splice(0)) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  };
  return {
    id: 'scene-effect',
    kinds: ['hitResolved', 'collisionResolved', 'landed'],
    handle: () => {
      readAnchor('tip', out);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial());
      mesh.position.set(out.x, out.y, out.z);
      root.add(mesh);
      meshes.push(mesh);
    },
    reset: clear,
    dispose: clear,
    getCounts: () => ({ meshes: meshes.length }),
    alive: () => meshes.length,
  };
}

interface RunResult {
  readonly hashes: string[];
  readonly replayIntegrity: string;
  readonly camera: string;
  readonly recorder: Recorder | null;
}

async function run(features: PresentationFeatures | undefined, attach: boolean): Promise<RunResult> {
  const { session, camera } = await createSession(features);
  let recorder: Recorder | null = null;
  if (attach) {
    recorder = new Recorder();
    session.getPresentation().attach(recorder);
    const director = new VfxDirector();
    director.register(sceneEffect(session.getSceneRoot(), (name, out) => session.getVfxAnchor('second', name, out)));
    session.getPresentation().attach(director);
  }
  session.startReplayCapture({ fingerprint: FINGERPRINT, checkpointEvery: 30 });
  const hashes = [session.getStateHash()];
  const cameraSamples: string[] = [];
  for (let i = 0; i < TICKS && !session.roundState.isOver; i++) {
    session.tick();
    session.renderFrame(1 / 60, camera);
    hashes.push(session.getStateHash());
    const cam = session.getLastCameraOutput();
    if (cam) cameraSamples.push(JSON.stringify([cam.cameraPositionM, cam.focusPositionM, cam.fovDeg, cam.shakeOffsetM, cam.mode]));
    if (attach) {
      // Anchors are read every frame, as a visual system would.
      const out = { x: 0, y: 0, z: 0 };
      for (const side of ['first', 'second'] as const) for (const name of ['center', 'tip', 'topLayer', 'ringRim']) session.getVfxAnchor(side, name, out);
    }
  }
  const { replay } = session.finishReplayCapture();
  session.dispose();
  return { hashes, replayIntegrity: replay.integrity, camera: cameraSamples.join('\n'), recorder };
}

describe('presentation foundation is behaviour-neutral on a real session', () => {
  it('gives the identical simulation, replay and camera with flags off, flags on, and systems attached', async () => {
    const off = await run(undefined, false);
    const explicitOff = await run(PRESENTATION_FEATURES_OFF, false);
    const on = await run(ALL_ON, false);
    const attached = await run(ALL_ON, true);

    expect(off.hashes.length).toBeGreaterThan(300);
    for (const other of [explicitOff, on, attached]) {
      expect(other.hashes).toEqual(off.hashes);
      expect(other.replayIntegrity).toBe(off.replayIntegrity);
      expect(other.camera).toBe(off.camera);
    }
  }, 120_000);

  it('delivers real events and states to an attached system, in tick order, without gameplay-derived events twice', async () => {
    const { recorder } = await run(ALL_ON, true);
    const events = recorder!.events;
    const kinds = new Set(events.map((event) => event.kind));
    expect(events.length).toBeGreaterThan(0);
    // A seeded AI-vs-AI fight over this many ticks always lands hits and bounces.
    expect(kinds.has('hitResolved') || kinds.has('collisionResolved') || kinds.has('landed')).toBe(true);
    for (let i = 1; i < events.length; i++) expect(events[i]!.tick).toBeGreaterThanOrEqual(events[i - 1]!.tick);
    expect(recorder!.states.at(-1)?.first.definitionId).toBe('attack-prototype');
    // The shot is exposed read-only: a mode name and numbers, nothing to write back with.
    const camera = recorder!.states.at(-1)?.camera;
    expect(camera).not.toBeNull();
    expect(typeof camera!.mode).toBe('string');
    expect(camera!.fovDeg).toBeGreaterThan(30);
    expect(camera!.fovDeg).toBeLessThanOrEqual(120);
    expect(recorder!.states.every((state) => state.first.stamina >= 0 && state.first.stamina <= 1)).toBe(true);
    // One roundEnded at most, and only if the round ended.
    expect(events.filter((event) => event.kind === 'roundEnded').length).toBeLessThanOrEqual(1);
    expect(recorder!.frames).toBeGreaterThan(0);
    expect(recorder!.created).toBe(1);
    expect(recorder!.disposed).toBe(1);
  }, 120_000);
});

describe('presentation lifecycle on a real session', () => {
  it('ships with nothing attached and the legacy placeholder visuals, whatever the flags', async () => {
    for (const features of [undefined, ALL_ON]) {
      const { session } = await createSession(features);
      expect(session.getPresentation().systemIds()).toEqual([]);
      expect(session.getPresentationStats().hub.systems).toBe(0);
      expect(session.match.visuals.first.definition.id).toBe('placeholder:attack-prototype');
      expect(session.match.visuals.second.definition.id).toBe('placeholder:defense-prototype');
      session.dispose();
    }
  });

  it('answers VFX anchors on the live Bey: the tip is under the body and follows it', async () => {
    const { session, camera } = await createSession(undefined);
    for (let i = 0; i < 30; i++) session.tick();
    session.renderFrame(1 / 60, camera);
    const tip = { x: 0, y: 0, z: 0 };
    const center = { x: 0, y: 0, z: 0 };
    expect(session.getVfxAnchor('first', 'tip', tip)).toBe(true);
    expect(session.getVfxAnchor('first', 'center', center)).toBe(true);
    expect(tip.y).toBeLessThan(center.y);
    const body = session.getBey('first').body.translation();
    expect(center.x).toBeCloseTo(body.x, 5);
    expect(center.z).toBeCloseTo(body.z, 5);
    expect(session.getVfxAnchor('first', 'not-an-anchor', tip)).toBe(false);
    session.dispose();
  });

  it('disposes attached systems with the session, once, and delivers nothing afterwards', async () => {
    const { session } = await createSession(ALL_ON);
    const recorder = new Recorder();
    session.getPresentation().attach(recorder);
    for (let i = 0; i < 20; i++) session.tick();
    session.dispose();
    session.dispose();
    expect(recorder.disposed).toBe(1);
    expect(session.getPresentation().isDisposed()).toBe(true);
    expect(() => session.getPresentation().attach(new Recorder())).toThrow(/disposed/);
  });

  it('does not leak between sessions: a restart starts with a fresh hub and the old systems hear nothing', async () => {
    const first = await createSession(ALL_ON);
    const oldRecorder = new Recorder();
    first.session.getPresentation().attach(oldRecorder);
    for (let i = 0; i < 10; i++) first.session.tick();
    const heard = oldRecorder.states.length;
    first.session.dispose();

    const second = await createSession(ALL_ON, `${SEED}-restart`);
    expect(second.session.getPresentation()).not.toBe(first.session.getPresentation());
    expect(second.session.getPresentation().systemIds()).toEqual([]);
    const newRecorder = new Recorder();
    second.session.getPresentation().attach(newRecorder);
    for (let i = 0; i < 10; i++) second.session.tick();
    expect(oldRecorder.states.length).toBe(heard);
    expect(newRecorder.states.length).toBeGreaterThan(0);
    expect(newRecorder.states.every((state) => state.tick < 10)).toBe(true);
    second.session.dispose();
  }, 60_000);

  it('leaves no orphan scene objects: effects clear on reset and on dispose, and the root goes with the session', async () => {
    const { session, scene, camera } = await createSession(ALL_ON);
    const baseline = collectSceneStats(session.getSceneRoot());
    const effect = sceneEffect(session.getSceneRoot(), (name, out) => session.getVfxAnchor('second', name, out));
    const director = new VfxDirector();
    director.register(effect);
    session.getPresentation().attach(director);

    let peak = 0;
    for (let i = 0; i < TICKS && !session.roundState.isOver; i++) {
      session.tick();
      session.renderFrame(1 / 60, camera);
      peak = Math.max(peak, effect.alive());
    }
    expect(peak).toBeGreaterThan(0);
    expect(session.getPresentationStats().hub.perSystem['vfx-director']).toMatchObject({ effects: 1 });

    session.getPresentation().reset();
    expect(effect.alive()).toBe(0);
    // Everything the effect added is gone; what remains of the census is the session's own VFX.
    const afterReset = collectSceneStats(session.getSceneRoot());
    expect(afterReset.meshes).toBeLessThanOrEqual(baseline.meshes + 40);

    session.tick();
    session.dispose();
    expect(effect.alive()).toBe(0);
    expect(scene.children.some((child) => child === session.getSceneRoot())).toBe(false);
  }, 120_000);
});

describe('arena theme never reaches a collider', () => {
  async function colliderSignature(theme: typeof FOUNDRY_PIT.theme, geometry = FOUNDRY_PIT.geometry): Promise<string[]> {
    const physics = await PhysicsWorld.create();
    createArenaColliders(new THREE.Group(), physics, geometry, theme);
    const rows: string[] = [];
    physics.rapierWorld.colliders.forEach((collider) => {
      const t = collider.translation();
      const r = collider.rotation();
      rows.push(JSON.stringify([collider.shapeType(), collider.halfExtents?.(), t, r, collider.friction(), collider.restitution()]));
    });
    physics.rapierWorld.free();
    return rows.sort();
  }

  it('builds identical colliders for any theme with the same geometry, and different ones for different geometry', async () => {
    const foundry = await colliderSignature(FOUNDRY_PIT.theme);
    expect(foundry.length).toBeGreaterThan(1);
    expect(await colliderSignature(RIFT_CRATER.theme)).toEqual(foundry);
    expect(await colliderSignature(TOURNAMENT_STADIUM.theme)).toEqual(foundry);
    // Control: geometry does change them, so the comparison can tell.
    expect(await colliderSignature(FOUNDRY_PIT.theme, TOURNAMENT_STADIUM.geometry)).not.toEqual(foundry);
  });
});
