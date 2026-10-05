// M11 lane 2 + Inertial Duel Camera integration.
//
// The approved Camera Lab director/presets remain byte-for-byte preserved as
// the base presentation generator. The in-game CameraRig now wraps each base
// director in InertialDuelDirector: normal-combat yaw is composition-driven
// and spatially persistent, while Clash still forces B and gameplay remains
// completely independent of camera presentation.

import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { CameraDirector as LabDirector } from '../../prototypes/camera-concepts/src/director/CameraDirector';
import { PARAM_SPEC, PRESETS as LAB_PRESETS } from '../../prototypes/camera-concepts/src/director/CameraParams';
import { RealSimSource } from '../../prototypes/camera-concepts/src/fight/RealSimSource';
import { scenarioById } from '../../prototypes/camera-concepts/src/fight/scenarios';
import type { FightFrame } from '../../prototypes/camera-concepts/src/fight/FightFrame';
import { CameraDirector } from '../../src/camera/director/CameraDirector';
import { InertialDuelDirector, type InertialDirectorOutput } from '../../src/camera/director/InertialDuelDirector';
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/camera/director/CameraParams';
import {
  arenaParamsFor,
  CameraRig,
  CAMERA_CONTAIN_RADIUS_M,
  CAMERA_EDGE_MARGIN_M,
  CAMERA_RINGOUT_WATCH_RADIUS_M,
  CLASH_FORCED_PRESET,
  PRESET_SWITCH_BLEND_S,
  rigDirectorOptions,
  type CameraRigOutput,
} from '../../src/camera/director/CameraRig';
import { inFrame } from '../../src/camera/director/frameMath';
import { floorHeightAt } from '../../src/arena/floor/ArenaFloorProfile';
import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

const DT = 1 / 60;
const sources: RealSimSource[] = [];
afterAll(() => sources.forEach((s) => s.dispose()));

const frameCache = new Map<string, FightFrame[]>();
async function framesOf(id: string): Promise<FightFrame[]> {
  const cached = frameCache.get(id);
  if (cached) return cached;
  const scenario = scenarioById(id);
  const src = await RealSimSource.create(scenario);
  sources.push(src);
  const frames: FightFrame[] = [];
  for (let i = 0; i < Math.round(scenario.durationS / DT); i++) frames.push(src.step());
  frameCache.set(id, frames);
  return frames;
}

function newInertial(preset: PresetId, floorAt?: (x: number, z: number) => number): InertialDuelDirector {
  return new InertialDuelDirector(
    preset,
    arenaParamsFor(preset),
    16 / 9,
    rigDirectorOptions(preset, floorAt),
    CAMERA_RINGOUT_WATCH_RADIUS_M,
  );
}

function runStandalone(frames: readonly FightFrame[], preset: PresetId, floorAt?: (x: number, z: number) => number): InertialDirectorOutput[] {
  const d = newInertial(preset, floorAt);
  return frames.map((f) => {
    const o = d.tick(f as never, DT);
    return {
      ...o,
      eye: { ...o.eye },
      focus: { ...o.focus },
      shake: { ...o.shake },
      weights: { ...o.weights },
      debug: { ...o.debug, modifiers: [...o.debug.modifiers], composition: { ...o.debug.composition } },
    };
  });
}

function runRig(frames: readonly FightFrame[], preset: PresetId, onTick?: (i: number, rig: CameraRig) => void, floorAt?: (x: number, z: number) => number): CameraRigOutput[] {
  const rig = new CameraRig(preset, 16 / 9, floorAt);
  return frames.map((f, i) => {
    onTick?.(i, rig);
    const out = rig.tick(f as never, DT);
    return { ...out, eye: { ...out.eye }, focus: { ...out.focus }, shake: { ...out.shake } };
  });
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));

describe('approved Camera Lab remains the immutable base generator', () => {
  it('the three presets are exactly the approved values (every parameter)', () => {
    expect(PRESETS).toEqual(LAB_PRESETS);
    for (const id of PRESET_IDS) expect(Object.keys(PRESETS[id]).sort()).toEqual(PARAM_SPEC.map((p) => p.key).sort());
    expect(PRESETS.A).toMatchObject({ baseFov: 58, maxFov: 74, orbitSpeed: 40, sideSwitchCooldown: 60, shakeIntensity: 0.6 });
    expect(PRESETS.B).toMatchObject({ baseFov: 62, maxFov: 88, orbitSpeed: 70, sideSwitchCooldown: 6, shakeIntensity: 1 });
    expect(PRESETS.C).toMatchObject({ baseFov: 66, maxFov: 100, orbitSpeed: 105, sideSwitchCooldown: 3, shakeIntensity: 1.4 });
  });

  it('with default options the port still reproduces the Camera Lab tick for tick', async () => {
    for (const scenario of ['normal-duel', 'clash-setup']) {
      const frames = await framesOf(scenario);
      for (const id of PRESET_IDS) {
        const lab = new LabDirector({ ...LAB_PRESETS[id] });
        const game = new CameraDirector(PRESETS[id]);
        for (const f of frames) {
          const a = lab.tick(f, DT);
          const b = game.tick(f as never, DT);
          expect(b.eye).toEqual(a.eye);
          expect(b.focus).toEqual(a.focus);
          expect(b.fov).toBe(a.fov);
          expect(b.mode).toBe(a.mode);
        }
      }
    }
  }, 120_000);

  it('clashOrbit: false changes nothing outside the Clash and holds the base angle during it', async () => {
    const frames = await framesOf('clash-setup');
    const orbit = new CameraDirector(PRESETS.B);
    const still = new CameraDirector(PRESETS.B, 16 / 9, { clashOrbit: false });
    let orbitTurn = 0;
    let stillTurn = 0;
    let prevOrbit: number | null = null;
    let prevStill: number | null = null;
    let clashTicks = 0;
    let seenClash = false;
    for (const f of frames) {
      const a = orbit.tick(f, DT);
      const b = still.tick(f as never, DT);
      if (!seenClash && !f.clashActive) expect(b.eye).toEqual(a.eye);
      seenClash ||= f.clashActive;
      if (f.clashActive && a.weights.Clash > 0.95) {
        clashTicks++;
        if (prevOrbit !== null) orbitTurn += Math.abs(angleDelta(prevOrbit, a.debug.yawDeg * (Math.PI / 180)));
        if (prevStill !== null) stillTurn += Math.abs(angleDelta(prevStill, b.debug.yawDeg * (Math.PI / 180)));
        prevOrbit = a.debug.yawDeg * (Math.PI / 180);
        prevStill = b.debug.yawDeg * (Math.PI / 180);
      }
    }
    expect(clashTicks).toBeGreaterThan(120);
    expect(orbitTurn).toBeGreaterThan(0.8);
    expect(stillTurn).toBeLessThan(0.05);
  }, 60_000);
});

describe('CameraRig — inertial player camera + Clash forces inertial B', () => {
  it('for A and C the full Clash blend shows B, then hands back exactly to the player inertial preset', async () => {
    const frames = await framesOf('clash-setup');
    const forcedOut = runStandalone(frames, CLASH_FORCED_PRESET);
    for (const preset of ['A', 'C'] as const) {
      const ownOut = runStandalone(frames, preset);
      const rig = runRig(frames, preset);
      const full = rig.map((o, i) => ({ o, i })).filter(({ o }) => o.clashBlend > 0.999);
      expect(full.length).toBeGreaterThan(90);
      for (const { o, i } of full) {
        expect(dist(o.eye, forcedOut[i]!.eye)).toBeLessThan(0.02);
        expect(o.mode).toBe('Clash');
      }
      const lastClash = frames.map((f) => f.clashActive).lastIndexOf(true);
      const back = rig.findIndex((o, i) => i > lastClash && o.clashBlend === 0);
      expect(back).toBeGreaterThan(lastClash);
      for (let i = back; i < rig.length; i++) expect(rig[i]!.eye).toEqual(ownOut[i]!.eye);
      expect(rig.at(-1)!.preset).toBe(preset);
    }
  }, 60_000);

  it('a player on B sees exactly the standalone inertial B director', async () => {
    const frames = await framesOf('clash-setup');
    const own = runStandalone(frames, 'B');
    const rig = runRig(frames, 'B');
    frames.forEach((_, i) => {
      expect(rig[i]!.eye).toEqual(own[i]!.eye);
      expect(rig[i]!.focus).toEqual(own[i]!.focus);
      expect(rig[i]!.fov).toBe(own[i]!.fov);
    });
  }, 60_000);

  it('entering and leaving Clash remains continuous — no presentation cut', async () => {
    const frames = await framesOf('clash-setup');
    for (const preset of PRESET_IDS) {
      const rig = runRig(frames, preset);
      let maxStep = 0;
      // Play frames only, as the in-frame check below: since the speed pass (owner, 2026-10-04) this scenario ends by a
      // knock-out with the loser flying off at 21 m/s, and preset B chasing that frozen, finished round moved its eye
      // 1.14 m in one frame — after the round, nothing to do with entering or leaving the Clash (worst before: 0.69 m).
      for (let i = 1; i < rig.length; i++) if (!frames[i]!.roundOver) maxStep = Math.max(maxStep, dist(rig[i]!.eye, rig[i - 1]!.eye));
      expect(maxStep, `preset ${preset}`).toBeLessThan(1);
    }
  }, 60_000);

  it('both Beys stay in frame through the Clash for every preset', async () => {
    const frames = await framesOf('clash-setup');
    for (const preset of PRESET_IDS) {
      const rig = runRig(frames, preset);
      let play = 0;
      let opponent = 0;
      let player = 0;
      frames.forEach((f, i) => {
        if (f.roundOver) return;
        play++;
        const o = rig[i]!;
        if (inFrame(f.second.position, o.eye, o.focus, o.fov, 16 / 9, 0.02)) opponent++;
        if (inFrame(f.first.position, o.eye, o.focus, o.fov, 16 / 9, 0.02)) player++;
        expect(o.fov).toBeLessThanOrEqual(120);
      });
      expect(opponent / play, `preset ${preset}`).toBeGreaterThanOrEqual(0.95);
      expect(player / play, `preset ${preset}`).toBeGreaterThanOrEqual(0.95);
    }
  }, 60_000);
});

describe('CameraRig — preset switch mid-match', () => {
  it('crossfades to the warm inertial target and then matches it exactly', async () => {
    const frames = await framesOf('normal-duel');
    const probe = runRig(frames, 'A');
    const switchAt = probe.findIndex((_, i) => i > 120 && probe.slice(i, i + 60).every((o) => o.clashBlend === 0));
    expect(switchAt).toBeGreaterThan(120);

    const rig = runRig(frames, 'A', (i, r) => {
      if (i === switchAt) r.setPreset('C');
    });
    const cOut = runStandalone(frames, 'C');
    const settled = switchAt + Math.ceil(PRESET_SWITCH_BLEND_S / DT) + 1;
    expect(rig[settled]!.presetSwitch).toBe(1);
    if (rig[settled]!.clashBlend === 0) expect(rig[settled]!.eye).toEqual(cOut[settled]!.eye);

    let maxStep = 0;
    for (let i = switchAt; i < settled; i++) maxStep = Math.max(maxStep, dist(rig[i + 1]!.eye, rig[i]!.eye));
    expect(maxStep).toBeLessThan(0.8);
    expect(rig.at(-1)!.preset).toBe('C');
  }, 60_000);
});

describe('presentation only', () => {
  it('the camera preset never changes the match: identical state hashes for A, B and C, including a live switch', async () => {
    const hashes: string[][] = [];
    for (const preset of PRESET_IDS) {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, 16 / 9);
      scene.add(camera);
      const session = await MatchSession.create({
        scene,
        camera,
        seedText: 'm11-camera-presets',
        matchConfig: resolveMatchConfig(),
        attackProfileSettings: createDefaultAttackProfileSettings(),
        telemetry: new TelemetryRecorder(),
        stateMachine: new GameStateMachine(),
        controllers: { first: { kind: 'ai', personality: 'archetype' }, second: { kind: 'ai', personality: 'archetype' } },
        keyboard: new IdleController(),
        cameraPreset: preset,
      });
      const run: string[] = [];
      for (let i = 0; i < 900 && !session.roundState.isOver; i++) {
        session.tick();
        if (i === 450) session.setCameraPreset(preset === 'A' ? 'C' : 'A');
        if (i % 30 === 0) run.push(session.getStateHash());
      }
      expect(session.getLastCameraOutput()!.fovDeg).toBeLessThanOrEqual(120);
      hashes.push(run);
      session.dispose();
    }
    expect(hashes[1]).toEqual(hashes[0]);
    expect(hashes[2]).toEqual(hashes[0]);
  }, 120_000);
});

describe('36 m arena scale + inertial two-fighter framing', () => {
  const fighter = (x: number, z: number, vx = 0, vz = 0) => ({ position: { x, y: 0.2, z }, velocity: { x: vx, y: 0, z: vz }, speed: Math.hypot(vx, vz), airborne: false, attack: 'none' as const, broken: false });
  const frame = (t: number, p: ReturnType<typeof fighter>, o: ReturnType<typeof fighter>) => ({ tick: t, time: t / 60, first: p, second: o, intents: [], clashActive: false, clashProgress: 0, roundOver: false, ringOutIsFirst: null });

  it('derives presentation radii from the current arena instead of the old 12 m stage', () => {
    expect(CAMERA_CONTAIN_RADIUS_M).toBe(ARENA_FLOOR_RADIUS - CAMERA_EDGE_MARGIN_M);
    expect(CAMERA_RINGOUT_WATCH_RADIUS_M).toBe(RINGOUT_RADIUS_M - 3.9);
    expect(CAMERA_CONTAIN_RADIUS_M).toBeGreaterThan(30);
    expect(CAMERA_RINGOUT_WATCH_RADIUS_M).toBeGreaterThan(30);
  });

  it('the final in-game eye never crosses the arena-scale containment radius, including near-rim fights', () => {
    for (const preset of PRESET_IDS) {
      const d = newInertial(preset);
      for (const [px, pz, ox, oz] of [[33, 0, 25, 0], [0, -33, 3, -26], [-28, 18, -25, 15], [24, 24, -20, -20]] as const) {
        d.reset();
        for (let t = 0; t < 240; t++) {
          const out = d.tick(frame(t, fighter(px, pz), fighter(ox, oz)) as never, DT);
          expect(Math.hypot(out.eye.x, out.eye.z), `${preset} (${px},${pz})`).toBeLessThanOrEqual(CAMERA_CONTAIN_RADIUS_M + 1e-6);
        }
      }
    }
  });

  it('real scenario fights keep the final rig eye inside the current arena for every preset', async () => {
    for (const scenario of ['normal-duel', 'wall-ricochet', 'heavy-knockback', 'clash-setup']) {
      const frames = await framesOf(scenario);
      for (const preset of PRESET_IDS) {
        const out = runRig(frames, preset);
        const worst = Math.max(...out.map((o) => Math.hypot(o.eye.x, o.eye.z)));
        expect(worst, `${scenario} ${preset}`).toBeLessThanOrEqual(CAMERA_CONTAIN_RADIUS_M + 1e-6);
      }
    }
  }, 120_000);

  it('near/far two-fighter framing keeps both subjects visible without becoming top-down', () => {
    for (const preset of PRESET_IDS) {
      for (const sepM of [4, 8, 14, 18]) {
        const d = newInertial(preset);
        const p = fighter(0, -sepM / 2);
        const o = fighter(0, sepM / 2);
        let out = d.tick(frame(0, p, o) as never, DT);
        for (let t = 1; t < 240; t++) out = d.tick(frame(t, p, o) as never, DT);
        const label = `${preset} sep ${sepM}`;
        expect(inFrame(p.position, out.eye, out.focus, out.fov, 16 / 9, 0.02), `${label}: player in frame`).toBe(true);
        expect(inFrame(o.position, out.eye, out.focus, out.fov, 16 / 9, 0.02), `${label}: opponent in frame`).toBe(true);
        const pitchDeg = (Math.atan2(out.eye.y - out.focus.y, Math.hypot(out.eye.x - out.focus.x, out.eye.z - out.focus.z)) * 180) / Math.PI;
        expect(pitchDeg, `${label}: pitch`).toBeLessThan(55);
        expect(pitchDeg, `${label}: pitch`).toBeGreaterThan(3);
      }
    }
  });

  it('a full opponent orbit does not require the world to execute a matching full orbit', () => {
    for (const preset of PRESET_IDS) {
      const d = newInertial(preset);
      let out = d.tick(frame(0, fighter(0, -3), fighter(6, -3)) as never, DT);
      let opponentOffscreenTicks = 0;
      for (let t = 1; t <= 600; t++) {
        const a = (t / 600) * Math.PI * 2;
        const opponent = fighter(6 * Math.cos(a), -3 + 6 * Math.sin(a));
        out = d.tick(frame(t, fighter(0, -3), opponent) as never, DT);
        if (!inFrame(opponent.position, out.eye, out.focus, out.fov, 16 / 9, 0.02)) opponentOffscreenTicks++;
      }
      expect(opponentOffscreenTicks, `${preset}: opponent visibility`).toBeLessThanOrEqual(3);
      expect(out.debug.composition.totalYawTravelDeg, `${preset}: no automatic full-world orbit`).toBeLessThan(180);
      expect(out.debug.composition.yawReversals, `${preset}: no camera ping-pong`).toBeLessThanOrEqual(2);
    }
  });

  it('bowls: final inertial eye remains above the concave floor and inside the arena', () => {
    for (const floor of ['bowl-a', 'bowl-b', 'bowl-c'] as const) {
      for (const preset of PRESET_IDS) {
        const floorAt = (x: number, z: number) => floorHeightAt(floor, x, z);
        const d = newInertial(preset, floorAt);
        for (const [px, pz, ox, oz] of [[0, -10, 0, 2], [7, 7, -2, -2], [0, 2, 0, 9]] as const) {
          d.reset();
          const p = { ...fighter(px, pz), position: { x: px, y: floorAt(px, pz) + 0.2, z: pz } };
          const o = { ...fighter(ox, oz), position: { x: ox, y: floorAt(ox, oz) + 0.2, z: oz } };
          let out = d.tick(frame(0, p as never, o as never) as never, DT);
          for (let t = 1; t < 240; t++) out = d.tick(frame(t, p as never, o as never) as never, DT);
          expect(out.eye.y, `${floor} ${preset} floor clearance`).toBeGreaterThanOrEqual(floorAt(out.eye.x, out.eye.z) + PRESETS[preset].floorClearance - 1e-6);
          expect(Math.hypot(out.eye.x, out.eye.z), `${floor} ${preset} containment`).toBeLessThanOrEqual(CAMERA_CONTAIN_RADIUS_M + 1e-6);
        }
      }
    }
  });
});
