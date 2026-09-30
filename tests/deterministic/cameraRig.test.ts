// M11 lane 2: the game's camera is the approved Camera Lab director,
// ported unchanged, running the three approved presets. The Clash always
// forces camera B without orbit and hands back to the player's preset
// without a cut. Presentation only: the preset never changes the match.
//
// Fights come from the lab's real-simulation scenarios (tickMatch +
// Rapier + real AI / scripts), the same ones the approval measured.

import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { CameraDirector as LabDirector } from '../../prototypes/camera-concepts/src/director/CameraDirector';
import { PARAM_SPEC, PRESETS as LAB_PRESETS } from '../../prototypes/camera-concepts/src/director/CameraParams';
import { RealSimSource } from '../../prototypes/camera-concepts/src/fight/RealSimSource';
import { scenarioById } from '../../prototypes/camera-concepts/src/fight/scenarios';
import type { FightFrame } from '../../prototypes/camera-concepts/src/fight/FightFrame';
import { CameraDirector } from '../../src/camera/director/CameraDirector';
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/camera/director/CameraParams';
import { CameraRig, CLASH_FORCED_PRESET, PRESET_SWITCH_BLEND_S, RIG_DIRECTOR_OPTIONS, type CameraRigOutput } from '../../src/camera/director/CameraRig';
import { inFrame } from '../../src/camera/director/frameMath';
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

function runRig(frames: readonly FightFrame[], preset: PresetId, onTick?: (i: number, rig: CameraRig) => void): CameraRigOutput[] {
  const rig = new CameraRig(preset);
  return frames.map((f, i) => {
    onTick?.(i, rig);
    const out = rig.tick(f as never, DT);
    return { ...out, eye: { ...out.eye }, focus: { ...out.focus } };
  });
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const yawAround = (eye: { x: number; z: number }, center: { x: number; z: number }): number => Math.atan2(eye.x - center.x, eye.z - center.z);
const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));

describe('ported director = the approved Camera Lab', () => {
  it('the three presets are exactly the approved values (every parameter)', () => {
    expect(PRESETS).toEqual(LAB_PRESETS);
    for (const id of PRESET_IDS) expect(Object.keys(PRESETS[id]).sort()).toEqual(PARAM_SPEC.map((p) => p.key).sort());
    // Spot-check against camera-approval.md §12.
    expect(PRESETS.A).toMatchObject({ baseFov: 58, maxFov: 74, orbitSpeed: 40, sideSwitchCooldown: 60, shakeIntensity: 0.6 });
    expect(PRESETS.B).toMatchObject({ baseFov: 62, maxFov: 88, orbitSpeed: 70, sideSwitchCooldown: 6, shakeIntensity: 1 });
    expect(PRESETS.C).toMatchObject({ baseFov: 66, maxFov: 100, orbitSpeed: 105, sideSwitchCooldown: 3, shakeIntensity: 1.4 });
  });

  it('with default options it reproduces the lab director tick for tick, on a real duel and a real Clash', async () => {
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

  it('clashOrbit: false changes nothing outside the Clash and holds the angle during it', async () => {
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
      if (!seenClash && !f.clashActive) expect(b.eye).toEqual(a.eye); // identical until the Clash starts
      seenClash ||= f.clashActive;
      if (f.clashActive && a.weights.Clash > 0.95) {
        clashTicks++;
        if (prevOrbit !== null) orbitTurn += Math.abs(angleDelta(prevOrbit, a.debug.yawDeg * (Math.PI / 180)));
        if (prevStill !== null) stillTurn += Math.abs(angleDelta(prevStill, b.debug.yawDeg * (Math.PI / 180)));
        prevOrbit = a.debug.yawDeg * (Math.PI / 180);
        prevStill = b.debug.yawDeg * (Math.PI / 180);
      }
    }
    expect(clashTicks).toBeGreaterThan(120); // a real, ~4 s Clash
    expect(orbitTurn).toBeGreaterThan(0.8); // the lab camera orbits well over 45° …
    expect(stillTurn).toBeLessThan(0.05); // … the approved Clash camera holds (< 3° total)
  }, 60_000);
});

describe('CameraRig — Clash forces B without orbit', () => {
  it('for A and C the Clash shows camera B (no orbit), then hands back to the player preset exactly', async () => {
    const frames = await framesOf('clash-setup');
    const forced = new CameraDirector(PRESETS[CLASH_FORCED_PRESET], 16 / 9, RIG_DIRECTOR_OPTIONS);
    const forcedOut = frames.map((f) => {
      const o = forced.tick(f as never, DT);
      return { eye: { ...o.eye }, clash: o.weights.Clash };
    });
    for (const preset of ['A', 'C'] as const) {
      const own = new CameraDirector(PRESETS[preset], 16 / 9, RIG_DIRECTOR_OPTIONS);
      const ownOut = frames.map((f) => ({ ...own.tick(f as never, DT).eye }));
      const rig = runRig(frames, preset);
      const full = rig.map((o, i) => ({ o, i })).filter(({ o }) => o.clashBlend > 0.999);
      expect(full.length).toBeGreaterThan(90);
      for (const { o, i } of full) {
        expect(dist(o.eye, forcedOut[i]!.eye)).toBeLessThan(0.02);
        expect(o.mode).toBe('Clash');
      }
      // After the Clash the blend decays to zero and the player's preset is back, exactly.
      const lastClash = frames.map((f) => f.clashActive).lastIndexOf(true);
      const back = rig.findIndex((o, i) => i > lastClash && o.clashBlend === 0);
      expect(back).toBeGreaterThan(lastClash);
      for (let i = back; i < rig.length; i++) expect(rig[i]!.eye).toEqual(ownOut[i]); // exactly the player's own camera again
      expect(rig.at(-1)!.preset).toBe(preset);
    }
  }, 60_000);

  it('a player on B sees exactly the B director (forced camera = own camera)', async () => {
    const frames = await framesOf('clash-setup');
    const own = new CameraDirector(PRESETS.B, 16 / 9, RIG_DIRECTOR_OPTIONS);
    const rig = runRig(frames, 'B');
    frames.forEach((f, i) => expect(rig[i]!.eye).toEqual(own.tick(f as never, DT).eye));
  }, 60_000);

  it('entering and leaving the Clash never cuts: no eye jump bigger than the directors themselves make', async () => {
    const frames = await framesOf('clash-setup');
    for (const preset of PRESET_IDS) {
      const rig = runRig(frames, preset);
      const own = new CameraDirector(PRESETS[preset], 16 / 9, RIG_DIRECTOR_OPTIONS);
      const forced = new CameraDirector(PRESETS.B, 16 / 9, RIG_DIRECTOR_OPTIONS);
      let prevOwn: { x: number; y: number; z: number } | null = null;
      let prevForced: { x: number; y: number; z: number } | null = null;
      let maxDirectorStep = 0;
      frames.forEach((f) => {
        const a = { ...own.tick(f as never, DT).eye };
        const b = { ...forced.tick(f as never, DT).eye };
        if (prevOwn && prevForced) maxDirectorStep = Math.max(maxDirectorStep, dist(a, prevOwn), dist(b, prevForced));
        prevOwn = a;
        prevForced = b;
      });
      let maxRigStep = 0;
      for (let i = 1; i < rig.length; i++) maxRigStep = Math.max(maxRigStep, dist(rig[i]!.eye, rig[i - 1]!.eye));
      expect(maxRigStep, `preset ${preset}`).toBeLessThanOrEqual(maxDirectorStep * 1.25 + 0.05);
      expect(maxRigStep, `preset ${preset}`).toBeLessThan(1); // < 60 m/s: never a cut
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
  it('crossfades from the old preset to the new one without a cut, then matches the new director exactly', async () => {
    const frames = await framesOf('normal-duel');
    // A moment of ordinary play: the Clash camera fully gone for the whole crossfade.
    const probe = runRig(frames, 'A');
    const switchAt = probe.findIndex((_, i) => i > 120 && probe.slice(i, i + 60).every((o) => o.clashBlend === 0));
    expect(switchAt).toBeGreaterThan(120);
    const rig = runRig(frames, 'A', (i, r) => {
      if (i === switchAt) r.setPreset('C');
    });
    const c = new CameraDirector(PRESETS.C, 16 / 9, RIG_DIRECTOR_OPTIONS);
    const cOut = frames.map((f) => ({ ...c.tick(f as never, DT).eye }));
    const a = new CameraDirector(PRESETS.A, 16 / 9, RIG_DIRECTOR_OPTIONS);
    const aOut = frames.map((f) => ({ ...a.tick(f as never, DT).eye }));
    // The tick of the switch is still (almost exactly) A; one crossfade later it is C.
    expect(dist(rig[switchAt]!.eye, aOut[switchAt]!)).toBeLessThan(0.05);
    const settled = switchAt + Math.ceil(PRESET_SWITCH_BLEND_S / DT) + 1;
    const clashNear = frames.slice(settled - 1, settled + 1).some((f) => f.clashActive);
    if (!clashNear) expect(dist(rig[settled]!.eye, cOut[settled]!)).toBeLessThan(1e-9);
    let maxStep = 0;
    for (let i = switchAt; i < settled; i++) maxStep = Math.max(maxStep, dist(rig[i + 1]!.eye, rig[i]!.eye));
    expect(maxStep).toBeLessThan(0.6); // a crossfade, not a cut (A and C sit metres apart)
    expect(rig.at(-1)!.preset).toBe('C');
  }, 60_000);
});

describe('presentation only', () => {
  it('the camera preset never changes the match: identical state hashes for A, B and C', async () => {
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
        if (i === 450) session.setCameraPreset(preset === 'A' ? 'C' : 'A'); // a live switch changes nothing either
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

describe('in-game arena camera (owner playtest, M11)', () => {
  const fighter = (x: number, z: number, vx = 0, vz = 0) => ({ position: { x, y: 0.2, z }, velocity: { x: vx, y: 0, z: vz }, speed: Math.hypot(vx, vz), airborne: false, attack: 'none' as const, broken: false });
  const frame = (t: number, p: ReturnType<typeof fighter>, o: ReturnType<typeof fighter>) => ({ tick: t, time: t / 60, first: p, second: o, intents: [], clashActive: false, clashProgress: 0, roundOver: false, ringOutIsFirst: null });

  it('never leaves the arena and the wall never hides a Bey, even with the player against the wall', () => {
    for (const preset of PRESET_IDS) {
      for (const [px, pz, ox, oz] of [[10.5, 0, 0, 0], [0, -10.5, 3, 5], [-8, 7, -9, 6], [7.4, 7.4, -7.4, -7.4]] as const) {
        const d = new CameraDirector(PRESETS[preset], 16 / 9, RIG_DIRECTOR_OPTIONS);
        for (let t = 0; t < 240; t++) {
          const o = d.tick(frame(t, fighter(px, pz), fighter(ox, oz)) as never, DT);
          expect(Math.hypot(o.eye.x, o.eye.z), `${preset} (${px},${pz})`).toBeLessThanOrEqual(10.5 + 1e-9);
        }
      }
    }
  });

  it('real fights: the eye stays inside the arena on every tick, for every preset', async () => {
    for (const scenario of ['normal-duel', 'wall-ricochet', 'heavy-knockback', 'clash-setup']) {
      const frames = await framesOf(scenario);
      for (const preset of PRESET_IDS) {
        const out = runRig(frames, preset);
        const worst = Math.max(...out.map((o) => Math.hypot(o.eye.x, o.eye.z)));
        expect(worst, `${scenario} ${preset}`).toBeLessThanOrEqual(10.5 + 1e-9);
      }
    }
  }, 120_000);

  it('does not follow every move: the player circling the opponent or running past it does not swing it round', () => {
    const d = new CameraDirector(PRESETS.C, 16 / 9, RIG_DIRECTOR_OPTIONS);
    // The player circles 50° around the opponent: the camera holds its angle.
    let first = 0;
    let last = 0;
    for (let t = 0; t < 180; t++) {
      const a = (t / 180) * (50 * Math.PI) / 180;
      const o = d.tick(frame(t, fighter(-4 * Math.cos(a), -4 * Math.sin(a)), fighter(0, 0)) as never, DT);
      if (t === 20) first = o.debug.yawDeg;
      last = o.debug.yawDeg;
    }
    expect(Math.abs(last - first)).toBeLessThan(3);
    // The player runs straight past the opponent (the axis flips 180°): the camera does not do a half-turn.
    const e = new CameraDirector(PRESETS.C, 16 / 9, RIG_DIRECTOR_OPTIONS);
    let start = 0;
    let maxTurn = 0;
    for (let t = 0; t < 240; t++) {
      const x = -6 + (12 * t) / 240;
      const o = e.tick(frame(t, fighter(x, 0.5, 3, 0), fighter(0, 0)) as never, DT);
      if (t === 10) start = o.debug.yawDeg;
      if (t > 10) maxTurn = Math.max(maxTurn, Math.abs(((o.debug.yawDeg - start + 540) % 360) - 180));
    }
    expect(maxTurn).toBeLessThan(45);
  });

  it('holds its angle for the round: the opponent circling a standing player turns it by less than 2°, for every preset', () => {
    // Owner playtest (after M11): in a real match the camera turned 127° in 3 s while the AI
    // circled and the player had not touched a key, so the arrows kept changing meaning.
    const yawTurn = (from: number, to: number): number => Math.abs(((to - from + 540) % 360) - 180);
    for (const preset of PRESET_IDS) {
      const d = new CameraDirector(PRESETS[preset], 16 / 9, RIG_DIRECTOR_OPTIONS);
      let start = 0;
      let worst = 0;
      for (let t = 0; t < 360; t++) {
        const a = Math.PI / 2 + (t / 360) * Math.PI * 1.5; // the opponent sweeps 270° around the player, 6 m out
        const o = d.tick(frame(t, fighter(0, -4), fighter(6 * Math.cos(a), -4 + 6 * Math.sin(a))) as never, DT);
        if (t === 0) start = o.debug.yawDeg;
        worst = Math.max(worst, yawTurn(start, o.debug.yawDeg));
      }
      expect(worst, preset).toBeLessThan(2);
    }
  });

  it('does not drag along with small moves: the framing point waits until the fight has moved 1.5 m', () => {
    const d = new CameraDirector(PRESETS.B, 16 / 9, RIG_DIRECTOR_OPTIONS);
    let settled = { x: 0, z: 0 };
    for (let t = 0; t < 240; t++) {
      const o = d.tick(frame(t, fighter(0, -3), fighter(0, 3)) as never, DT);
      settled = { x: o.eye.x, z: o.eye.z };
    }
    // The player shuffles 1 m to the side and back, twice.
    let drift = 0;
    for (let t = 240; t < 480; t++) {
      const x = Math.sin(((t - 240) / 120) * Math.PI * 2);
      const o = d.tick(frame(t, fighter(x, -3), fighter(0, 3)) as never, DT);
      drift = Math.max(drift, Math.hypot(o.eye.x - settled.x, o.eye.z - settled.z));
    }
    expect(drift).toBeLessThan(0.05);
  });
});
