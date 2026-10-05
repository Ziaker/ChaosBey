// Owner, 2026-10-05: "quanto aos sliders de tamanho do bey, levou em conta os efeitos ficarem maiores também: todos" +
// "adicione um slider pra isso também". Every effect follows the Bey size (MatchConfig.beySizeScale) × the Pregame's
// effects size (VfxOptions.effectSize). Presentation only: the match is identical at any effects size.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { createDefaultMatchSetup, loadLastSetup, saveLastSetup } from '../../src/app/frontend/matchSetup';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { PRESENTATION_FEATURES_DEFAULT } from '../../src/presentation/features';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { FxLayer } from '../../src/vfx/hybrid/fx/FxLayer';
import { burstFx, flatFx, ghostFx, spriteFx } from '../../src/vfx/hybrid/fx/primitives';
import { DEFAULT_VFX_OPTIONS, effectScaleOf, VFX_EFFECT_SIZE_RANGE, type VfxOptions } from '../../src/vfx/hybrid/intensityTiers';
import { RecoveryRingEffect } from '../../src/vfx/RecoveryRing';
import { DriftVfx } from '../../src/vfx/DriftVfx';
import { createLandingBurst, updateLandingBurst } from '../../src/vfx/LandingBurstVfx';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const TEX = new THREE.Texture();

async function session(beySizeScale: number, vfx: VfxOptions, opponentFrames: ControllerActions[] = [], seed = 'fx-size'): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  return MatchSession.create({
    scene,
    camera,
    seedText: seed,
    matchConfig: resolveMatchConfig({ beySizeScale }),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: { kind: 'keyboard' }, second: { kind: 'replay', label: 'opponent', frames: opponentFrames } },
    keyboard: new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }, { fromTick: 60, held: [Action.Dodge] }, { fromTick: 61, held: [Action.Attack] }, { fromTick: 63, held: [] }]),
    presentationFeatures: PRESENTATION_FEATURES_DEFAULT,
    vfx,
  });
}

interface Internals {
  hybridVfx: { layer: FxLayer; sparks: { scale: number }; tracks: Record<'first' | 'second', { vortex: { object: THREE.Object3D } }> };
  conditionVisuals: { glow: { effectScale: number }; soft: { effectScale: number } };
  clashPresentation: { fx: { scale: number } };
  recoveryRings: RecoveryRingEffect;
  impactFeedback: { effectScale: number; effectSize: number };
  vfxManager: { effectScale: number };
  driftVfx: Record<'first' | 'second', { effectScale: number }>;
}

describe('effects size: the Pregame slider', () => {
  it('×0.5–2, default ×1; remembered with the setup; an older save without it reads ×1', () => {
    expect(DEFAULT_VFX_OPTIONS.effectSize).toBe(1);
    expect(VFX_EFFECT_SIZE_RANGE).toMatchObject({ min: 0.5, max: 2 });
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveLastSetup({ ...createDefaultMatchSetup(), visual: { ...DEFAULT_VFX_OPTIONS, effectSize: 1.6 } }, storage);
    expect(loadLastSetup(storage)!.visual.effectSize).toBe(1.6);
    expect(effectScaleOf({ sizeScale: 2 }, { effectSize: 1.5 })).toBe(3);
    expect(effectScaleOf({}, { intensity: 1, groundWaves: 1, dust: 1 } as VfxOptions)).toBe(1);
  });
});

describe('every effect system takes the Bey size × the effects size (real MatchSession)', () => {
  it('default: ×1 everywhere', async () => {
    const s = await session(1, DEFAULT_VFX_OPTIONS);
    const i = s as unknown as Internals;
    expect(i.hybridVfx.layer.scale).toBe(1);
    expect(i.clashPresentation.fx.scale).toBe(1);
    expect(i.conditionVisuals.glow.effectScale).toBe(1);
    expect(i.recoveryRings.effectScale).toBe(1);
    s.dispose();
  });

  it('Bey ×2 and effects ×1.5: every system at ×3 (the hit flash, which already hugs the Bey, at ×1.5 on top)', async () => {
    const s = await session(2, { ...DEFAULT_VFX_OPTIONS, effectSize: 1.5 });
    const i = s as unknown as Internals;
    expect(i.hybridVfx.layer.scale).toBe(3);
    expect(i.hybridVfx.sparks.scale).toBe(3);
    expect(i.hybridVfx.tracks.first.vortex.object.scale.x).toBe(3);
    expect(i.conditionVisuals.glow.effectScale).toBe(3);
    expect(i.conditionVisuals.soft.effectScale).toBe(3);
    expect(i.clashPresentation.fx.scale).toBe(3);
    expect(i.recoveryRings.effectScale).toBe(3);
    expect(i.impactFeedback.effectScale).toBe(3);
    expect(i.impactFeedback.effectSize).toBe(1.5);
    expect(i.vfxManager.effectScale).toBe(3);
    expect(i.driftVfx.first.effectScale).toBe(3);
    expect(i.driftVfx.second.effectScale).toBe(3);
    s.dispose();
  });

  it('presentation only: the match is identical at effects ×0.5 and ×2', async () => {
    const opponent = Array.from({ length: 300 }, (_, t) => (t >= 40 && t < 60 ? { ...NONE, held: new Set([Action.Attack]), pressedThisFrame: new Set(t === 40 ? [Action.Attack] : []) } : NONE));
    const hashes = async (effectSize: number): Promise<string[]> => {
      const s = await session(1, { ...DEFAULT_VFX_OPTIONS, effectSize }, opponent);
      const camera = new THREE.PerspectiveCamera();
      const out: string[] = [];
      for (let t = 0; t < 240; t++) {
        s.tick();
        s.renderFrame(1 / 60, camera);
        out.push(s.getStateHash());
      }
      s.dispose();
      return out;
    };
    expect(await hashes(0.5)).toEqual(await hashes(2));
  }, 60_000); // two full sessions with every presentation system on: ~4 s here, over the 5 s default on the CI runner
});

describe('the effect layer scales what it emits', () => {
  const layer = (): FxLayer => new FxLayer(new THREE.Group(), new THREE.PerspectiveCamera());

  it('a burst at ×2 is twice the size at every moment of its life', () => {
    const one = layer();
    const two = layer();
    two.scale = 2;
    const a = burstFx({ tex: TEX, color: 0xffffff, pos: new THREE.Vector3(1, 0, 1), size: [0.5, 2], life: 1 });
    const b = burstFx({ tex: TEX, color: 0xffffff, pos: new THREE.Vector3(1, 0, 1), size: [0.5, 2], life: 1 });
    one.add(a);
    two.add(b);
    for (let f = 0; f < 5; f++) {
      expect(b.object.scale.x).toBeCloseTo(a.object.scale.x * 2, 9);
      expect(b.object.position.distanceTo(a.object.position)).toBeLessThan(1e-9);
      one.tick(0.1);
      two.tick(0.1);
    }
  });

  it('a drifting puff at ×2 is twice as big and drifts twice as far', () => {
    const one = layer();
    const two = layer();
    two.scale = 2;
    const mk = () => spriteFx({ tex: TEX, color: 0xffffff, pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(1, 0, 0), size: [1, 1], life: 1 });
    const a = mk();
    const b = mk();
    one.add(a);
    two.add(b);
    one.tick(0.5);
    two.tick(0.5);
    expect(b.object.scale.x).toBeCloseTo(a.object.scale.x * 2, 9);
    expect(b.object.position.x).toBeCloseTo(a.object.position.x * 2, 9);
  });

  it('a floor decal at ×2 drapes twice as wide on the floor (it scales itself); a Bey ghost keeps the Bey\'s size', () => {
    const two = layer();
    two.scale = 2;
    const decal = flatFx({ tex: TEX, color: 0xffffff, pos: new THREE.Vector3(0, 0, 0), size: [3, 3], life: 1, conform: { floorHeightAt: () => 0, lift: 0.02 } });
    two.add(decal);
    expect(decal.object.scale.x).toBeCloseTo(6, 9);
    const model = new THREE.Group();
    model.scale.setScalar(2); // the Bey's own model at ×2
    two.add(ghostFx(model, new THREE.MeshBasicMaterial({ transparent: true }), 0.5, 0.5));
    two.tick(0.1);
    expect(model.scale.x).toBe(2);
  });

  it('other effects: recovery ring, drift marks and the legacy landing ring at ×2', () => {
    const root = new THREE.Group();
    const one = new RecoveryRingEffect(root);
    one.spawn({ x: 0, y: 0, z: 0 });
    one.update(0.2);
    const r1 = root.children[0]!.scale.x;
    const root2 = new THREE.Group();
    const two = new RecoveryRingEffect(root2);
    two.effectScale = 2;
    two.spawn({ x: 0, y: 0, z: 0 });
    two.update(0.2);
    expect(root2.children[0]!.scale.x).toBeCloseTo(r1 * 2, 9);

    const firstMark = (scale: number): number => {
      const drift = new DriftVfx(0xffffff, 0x000000, () => 0, scale);
      drift.update(1 / 60, { position: { x: 0, y: 0.3, z: 0 }, velocity: { x: 0, y: 0, z: 10 }, headingRad: 0, driftState: 'Drifting', grounded: true });
      return (drift.object3D.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh).scale.x; // the drift-start scuff
    };
    expect(firstMark(2)).toBeCloseTo(firstMark(1) * 2, 9);

    const small = createLandingBurst(1, { x: 0, y: 0, z: 0 });
    const big = createLandingBurst(1, { x: 0, y: 0, z: 0 }, undefined, 2);
    expect(big.maxRadiusM).toBeCloseTo(small.maxRadiusM * 2, 9);
    updateLandingBurst(big, 0.1);
  });
});
