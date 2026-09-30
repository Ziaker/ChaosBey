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
import { CameraRig, CLASH_FORCED_PRESET, PRESET_SWITCH_BLEND_S, RIG_DIRECTOR_OPTIONS, rigDirectorOptions, type CameraRigOutput } from '../../src/camera/director/CameraRig';
import { inFrame } from '../../src/camera/director/frameMath';
import { floorHeightAt } from '../../src/arena/floor/ArenaFloorProfile';
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
    const forced = new CameraDirector(PRESETS[CLASH_FORCED_PRESET], 16 / 9, rigDirectorOptions(CLASH_FORCED_PRESET));
    const forcedOut = frames.map((f) => {
      const o = forced.tick(f as never, DT);
      return { eye: { ...o.eye }, clash: o.weights.Clash };
    });
    for (const preset of ['A', 'C'] as const) {
      const own = new CameraDirector(PRESETS[preset], 16 / 9, rigDirectorOptions(preset));
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
    const own = new CameraDirector(PRESETS.B, 16 / 9, rigDirectorOptions('B'));
    const rig = runRig(frames, 'B');
    frames.forEach((f, i) => expect(rig[i]!.eye).toEqual(own.tick(f as never, DT).eye));
  }, 60_000);

  it('entering and leaving the Clash never cuts: no eye jump bigger than the directors themselves make', async () => {
    const frames = await framesOf('clash-setup');
    for (const preset of PRESET_IDS) {
      const rig = runRig(frames, preset);
      const own = new CameraDirector(PRESETS[preset], 16 / 9, rigDirectorOptions(preset));
      const forced = new CameraDirector(PRESETS.B, 16 / 9, rigDirectorOptions('B'));
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
    const c = new CameraDirector(PRESETS.C, 16 / 9, rigDirectorOptions('C'));
    const cOut = frames.map((f) => ({ ...c.tick(f as never, DT).eye }));
    const a = new CameraDirector(PRESETS.A, 16 / 9, rigDirectorOptions('A'));
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
        const d = new CameraDirector(PRESETS[preset], 16 / 9, rigDirectorOptions(preset));
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

  // Owner playtest (after M11): "third person behind the Bey, behind and just a little above, over
  // the shoulder — the camera must look like it is FOLLOWING the Bey, not filming the arena".
  const project = (o: { eye: { x: number; y: number; z: number }; focus: { x: number; y: number; z: number }; fov: number }, p: { x: number; y: number; z: number }) => {
    const cam = new THREE.PerspectiveCamera(o.fov, 16 / 9, 0.05, 200);
    cam.position.set(o.eye.x, o.eye.y, o.eye.z);
    cam.lookAt(o.focus.x, o.focus.y, o.focus.z);
    cam.updateMatrixWorld();
    return new THREE.Vector3(p.x, p.y, p.z).project(cam);
  };
  const settle = (d: CameraDirector, p: ReturnType<typeof fighter>, o: ReturnType<typeof fighter>) => {
    let out = d.tick(frame(0, p, o) as never, DT);
    for (let t = 1; t < 240; t++) out = d.tick(frame(t, p, o) as never, DT);
    return out;
  };

  it('over the shoulder: player in the lower half, opponent ahead in frame, the eye low and behind — every preset, near and far', () => {
    for (const preset of PRESET_IDS) {
      for (const sepM of [4, 8, 14]) {
        const d = new CameraDirector(PRESETS[preset], 16 / 9, rigDirectorOptions(preset));
        const p = fighter(0, -sepM / 2);
        const o = fighter(0, sepM / 2);
        const out = settle(d, p, o);
        const label = `${preset} sep ${sepM}`;
        const player = project(out, p.position);
        const opponent = project(out, o.position);
        expect(player.y, `${label}: player in the lower half`).toBeLessThan(0);
        expect(Math.abs(player.x), `${label}: player on screen`).toBeLessThan(1);
        expect(Math.abs(opponent.x), `${label}: opponent in frame`).toBeLessThan(0.9);
        expect(Math.abs(opponent.y), `${label}: opponent in frame`).toBeLessThan(0.9);
        // Behind the player (the opponent's on the other side) and not far out.
        expect(out.eye.z, `${label}: behind the player`).toBeLessThan(p.position.z);
        const back = Math.hypot(out.eye.x - p.position.x, out.eye.z - p.position.z);
        expect(back, `${label}: close behind`).toBeLessThan(9);
        // Not an aerial view: low above the Bey (the lab presets sat 4–6 m up and more with
        // distance), looking down at a shallow angle.
        expect(out.eye.y - p.position.y, `${label}: low`).toBeLessThan(4.5);
        const pitchDeg = (Math.atan2(out.eye.y - out.focus.y, Math.hypot(out.eye.x - out.focus.x, out.eye.z - out.focus.z)) * 180) / Math.PI;
        expect(pitchDeg, `${label}: pitch`).toBeLessThan(30);
        expect(pitchDeg, `${label}: pitch`).toBeGreaterThan(3);
      }
    }
  });

  it('follows the player round smoothly: never faster than the preset\'s orbit cap, and holds up close', () => {
    for (const preset of PRESET_IDS) {
      const d = new CameraDirector(PRESETS[preset], 16 / 9, rigDirectorOptions(preset));
      settle(d, fighter(0, -3), fighter(0, 3));
      let previous = d.tick(frame(240, fighter(0, -3), fighter(0, 3)) as never, DT).debug.yawDeg;
      let worstStep = 0;
      // The opponent sweeps half-way round the player in one second: much faster than any cap.
      for (let t = 0; t < 60; t++) {
        const a = Math.PI / 2 + (t / 60) * Math.PI;
        const out = d.tick(frame(241 + t, fighter(0, -3), fighter(6 * Math.cos(a), -3 + 6 * Math.sin(a))) as never, DT);
        worstStep = Math.max(worstStep, Math.abs(((out.debug.yawDeg - previous + 540) % 360) - 180));
        previous = out.debug.yawDeg;
      }
      expect(worstStep, preset).toBeLessThanOrEqual(PRESETS[preset].orbitSpeed * DT + 1e-6);
      // Up close (touching) the axis is noise: the angle holds.
      const e = new CameraDirector(PRESETS[preset], 16 / 9, rigDirectorOptions(preset));
      const start = settle(e, fighter(0, -1), fighter(0, 1)).debug.yawDeg;
      let drift = 0;
      for (let t = 0; t < 120; t++) {
        const a = (t / 120) * Math.PI * 2;
        const out = e.tick(frame(240 + t, fighter(0, -1), fighter(Math.sin(a) * 1.2, -1 + Math.cos(a) * 1.2)) as never, DT);
        drift = Math.max(drift, Math.abs(((out.debug.yawDeg - start + 540) % 360) - 180));
      }
      expect(drift, `${preset} up close`).toBeLessThan(2);
    }
  });

  it('bowls: the eye stays above the concave floor and inside the arena, player against the rim', () => {
    for (const floor of ['bowl-a', 'bowl-b', 'bowl-c'] as const) {
      for (const preset of PRESET_IDS) {
        const floorAt = (x: number, z: number) => floorHeightAt(floor, x, z);
        const d = new CameraDirector(PRESETS[preset], 16 / 9, rigDirectorOptions(preset, floorAt));
        for (const [px, pz, ox, oz] of [[0, -10, 0, 2], [7, 7, -2, -2], [0, 2, 0, 9]] as const) {
          const p = { ...fighter(px, pz), position: { x: px, y: floorAt(px, pz) + 0.2, z: pz } };
          const o = { ...fighter(ox, oz), position: { x: ox, y: floorAt(ox, oz) + 0.2, z: oz } };
          const out = settle(d, p as never, o as never);
          expect(out.eye.y, `${floor} ${preset} (${px},${pz})`).toBeGreaterThanOrEqual(floorAt(out.eye.x, out.eye.z) + PRESETS[preset].floorClearance - 1e-6);
          expect(Math.hypot(out.eye.x, out.eye.z), `${floor} ${preset} (${px},${pz})`).toBeLessThanOrEqual(10.5 + 1e-6);
        }
      }
    }
  });
});
