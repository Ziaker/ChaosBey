// Bey Real in the game (0.59.0, owner 2026-10-09): the tuning list and its base preset, the setup, what the sliders turn into in
// the match's rules, the autopilot and the motion model (pure), the assisted controller and the cameras.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ADVANCED_CONTROLS, isLockedByRealMode, writeAdvanced } from '../../src/app/frontend/advancedControls';
import { createDefaultMatchSetup, defaultRealSetup, isRealMode, loadLastSetup, matchConfigFor, sanitizeRealSetup, saveLastSetup, activeRuleLines } from '../../src/app/frontend/matchSetup';
import { AssistedController } from '../../src/bey/real/AssistedController';
import { autopilotIntent, blendSteering } from '../../src/bey/real/RealAutopilot';
import { RealMotion } from '../../src/bey/real/RealMotion';
import {
  REAL_BASE_PARAMS,
  REAL_GROUP_ORDER,
  REAL_PARAM_SPEC,
  REAL_PRESETS,
  liveRealSpecs,
  matchingRealPreset,
  realModeConfigOf,
  realPresetValues,
  sanitizeRealParams,
  type RealParams,
} from '../../src/bey/real/RealTuning';
import { labEquivalentBowlDepthM, realMatchOverrides } from '../../src/bey/real/realMatchRules';
import { StaminaSystem } from '../../src/bey/stamina/StaminaSystem';
import { FreeOrbitCamera, RealModeCamera } from '../../src/camera/real/RealCameras';
import { REAL_CAMERA_MODES } from '../../src/camera/real/RealCameraModes';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';

/** The owner's tuned numbers, as pasted on 2026-10-09 ("esse preset atual … é pra ser o base"). */
const OWNER_JSON: RealParams = {
  influence: 0.75, steerAccelMps2: 30, cruiseSpeedMps: 14, pursuit: 1, orbitRadiusFrac: 0.8, bowlPull: 20, dragPerS: 0.1, tipFrictionMps2: 0.7, precessionRadPerS: 0.9,
  spinDecayPerS: 0.007, spinMoveLossPerM: 0.00035, spinSteerLoss: 0.00025, wobbleSpin: 0.35, wobbleAccelMps2: 10, massSecond: 1, sameSpin: 0, restitutionLow: 0.7,
  restitutionHigh: 0.92, rimFriction: 0.4, spinExchange: 0.012, hitSpinLoss: 0.004, rubSpinLoss: 0.0016, hitStability: 0.6, wallRestitution: 0.9, wallSpinLoss: 0.0016,
  dashMinSpeedMps: 10, dashMaxSpeedMps: 30, dashChargeMaxS: 1.6, dashDurationS: 0.8, dashCooldownS: 1.5, dashSnapRadPerS: 40, dashSnapWindowS: 0.08, dashLockRadPerS: 5,
  dashMassBoost: 1.8, dashStabilityMin: 10, dashStabilityMax: 25, dashSpinCost: 0.012, dashWhiffRecoveryS: 1.6, circularRadiusM: 1.55, circularDurationS: 0.35,
  circularRecoveryS: 0.95, circularLaunchMps: 9, circularLaunchUpMps: 7, circularKeepFraction: 0.65, circularStability: 12, dodgeSpeedMps: 22, dodgeBurstS: 0.17,
  dodgeInvulnS: 0.5, dodgeCooldownS: 3, dodgePerfectS: 0.2, dodgeSpinCost: 0.01, jumpSpeedMps: 10.5, gravityMps2: 31, airControl: 0, jumpCooldownS: 0.4,
  stageRadiusM: 15, wallHeightM: 1.6, ringOutDelayS: 0.6, timeLimitS: 150, stabilityRegenPerS: 5, brokenS: 2.4, aiAggression: 1, aiSkill: 0.85,
};

describe('Bey Real tuning', () => {
  it('the base preset is exactly the owner\'s tuned numbers', () => {
    expect({ ...REAL_BASE_PARAMS }).toEqual(OWNER_JSON);
    expect(realPresetValues('base')).toEqual(OWNER_JSON);
    expect(matchingRealPreset(OWNER_JSON)).toBe('base');
  });

  it('every value has one spec, inside its own range, with a note of its own and a group', () => {
    const keys = Object.keys(OWNER_JSON).sort();
    expect(keys, 'the owner\'s JSON has 63 values').toHaveLength(63);
    expect(REAL_PARAM_SPEC.map((s) => s.key).sort()).toEqual(keys);
    for (const spec of REAL_PARAM_SPEC) {
      expect(spec.min, spec.key).toBeLessThan(spec.max);
      expect(OWNER_JSON[spec.key], spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(OWNER_JSON[spec.key], spec.key).toBeLessThanOrEqual(spec.max);
      expect(spec.note.length, `${spec.key} has an explanation`).toBeGreaterThan(20);
      expect(REAL_GROUP_ORDER).toContain(spec.group);
      expect(spec.format(OWNER_JSON[spec.key])).not.toContain('NaN');
    }
    const notes = REAL_PARAM_SPEC.map((s) => s.note);
    expect(new Set(notes).size, 'no two sliders share an explanation').toBe(notes.length);
  });

  it('every preset stays inside the ranges and is told apart from the others', () => {
    for (const preset of REAL_PRESETS) {
      const values = realPresetValues(preset.id);
      for (const spec of REAL_PARAM_SPEC) {
        expect(values[spec.key], `${preset.id}.${spec.key}`).toBeGreaterThanOrEqual(spec.min);
        expect(values[spec.key], `${preset.id}.${spec.key}`).toBeLessThanOrEqual(spec.max);
      }
      expect(matchingRealPreset(values), preset.id).toBe(preset.id);
    }
    expect(matchingRealPreset({ ...REAL_BASE_PARAMS, cruiseSpeedMps: 9.5 })).toBeNull();
  });

  it('sanitizing clamps, ignores junk and falls back to the base', () => {
    const p = sanitizeRealParams({ influence: 5, cruiseSpeedMps: -2, bowlPull: 'x', pursuit: Number.NaN });
    expect(p.influence).toBe(1);
    expect(p.cruiseSpeedMps).toBe(3);
    expect(p.bowlPull).toBe(REAL_BASE_PARAMS.bowlPull);
    expect(p.pursuit).toBe(REAL_BASE_PARAMS.pursuit);
    expect(sanitizeRealParams(null)).toEqual({ ...REAL_BASE_PARAMS });
  });

  it('the Pregame lists only live sliders, every group in order, and the engine config carries the live movement values', () => {
    const live = liveRealSpecs();
    expect(live.length).toBeGreaterThan(25);
    const config = realModeConfigOf(REAL_BASE_PARAMS);
    for (const key of Object.keys(config) as (keyof typeof config)[]) expect(typeof config[key]).toBe('number');
    for (const key of ['influence', 'steerAccelMps2', 'cruiseSpeedMps', 'pursuit', 'orbitRadiusFrac', 'bowlPull', 'dragPerS', 'tipFrictionMps2', 'precessionRadPerS', 'wobbleSpin', 'wobbleAccelMps2', 'spinDecayPerS', 'spinMoveLossPerM', 'spinSteerLoss'] as const) {
      expect(live.some((s) => s.key === key), key).toBe(true);
    }
  });
});

describe('Bey Real setup', () => {
  it('is off by default, with the base values and the mode\'s own camera', () => {
    const setup = createDefaultMatchSetup();
    expect(setup.real).toEqual(defaultRealSetup());
    expect(isRealMode(setup)).toBe(false);
    expect(defaultRealSetup()).toMatchObject({ enabled: false, camera: 'real', presetId: 'base' });
    expect(matchConfigFor(setup).real).toBeUndefined();
  });

  it('off: the match config is the classic one, bit for bit', () => {
    const off = createDefaultMatchSetup();
    const edited = { ...off, real: { ...off.real!, camera: 'free' as const, params: { ...REAL_BASE_PARAMS, influence: 0.1, stageRadiusM: 9 } } };
    expect(matchConfigFor(edited)).toEqual(matchConfigFor({ ...off, real: undefined }));
  });

  it('on: the mode\'s sliders reach the ordinary rules, and `real` carries the motion model', () => {
    const setup = { ...createDefaultMatchSetup(), real: { ...defaultRealSetup(), enabled: true } };
    const config = matchConfigFor(setup);
    expect(config.real).toEqual(realModeConfigOf(REAL_BASE_PARAMS));
    expect(config.arenaSizeScale).toBeCloseTo(15 / 36, 6);
    expect(config.arenaWallHeightM).toBe(1.6);
    expect(config.arenaWallRestitution).toBe(0.9);
    expect(config.ringOutDelayS).toBe(0.6);
    expect(config.roundTimeLimitS).toBe(150);
    expect(config.gravityScale).toBeCloseTo(31 / 10.5, 6);
    expect(config.jumpFullHeightM).toBeCloseTo((10.5 * 10.5) / (2 * 31), 6);
    expect(config.airControl).toBe(0);
    expect(config.jumpCooldownS).toBe(0.4);
    expect(config.dashCooldownS).toBe(1.5);
    expect(config.dodgeCooldownS).toBe(3);
    expect(config.dodgeDistanceScale).toBeCloseTo(22 / 12.6, 6);
    expect(config.circularLaunchForce).toBeCloseTo(1, 6);
    expect(config.gameSpeed).toBe(1);
    expect(config.funnelPull).toBe(0);
  });

  it('the bowl is as steep, at the same distance from the centre, as on the lab\'s stage', () => {
    // h ∝ r^1.3 on the floor scaled to the stage: the same slope at r needs depth × scale^1.3.
    expect(labEquivalentBowlDepthM(36)).toBeCloseTo(7, 9);
    expect(labEquivalentBowlDepthM(15)).toBeCloseTo(7 * (15 / 36) ** 1.3, 9);
    expect(realMatchOverrides(REAL_BASE_PARAMS).arenaBowlDepthM).toBeCloseTo(labEquivalentBowlDepthM(15), 9);
  });

  it('is remembered with the setup and an old save without it reads as off', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const setup = { ...createDefaultMatchSetup(), real: { enabled: true, camera: 'free' as const, presetId: 'custom', params: { ...REAL_BASE_PARAMS, influence: 0.4, bowlPull: 33 } } };
    saveLastSetup(setup, storage);
    expect(loadLastSetup(storage)!.real).toEqual(setup.real);
    const raw = JSON.parse(store.get([...store.keys()][0]!)!);
    delete raw.real;
    store.set([...store.keys()][0]!, JSON.stringify(raw));
    expect(loadLastSetup(storage)!.real).toEqual(defaultRealSetup());
    expect(sanitizeRealSetup({ enabled: 'yes', camera: 'sideways', params: { influence: 9 } })).toMatchObject({ enabled: false, camera: 'real', params: { influence: 1 } });
  });

  it('says so in the active rules', () => {
    const setup = { ...createDefaultMatchSetup(), real: { ...defaultRealSetup(), enabled: true } };
    expect(activeRuleLines(setup).some((l) => l.startsWith('Bey Real'))).toBe(true);
    expect(activeRuleLines(createDefaultMatchSetup()).some((l) => l.startsWith('Bey Real'))).toBe(false);
  });

  it('while the mode is on, the classic sliders it takes over are locked (and only then)', () => {
    const off = createDefaultMatchSetup();
    const on = { ...off, real: { ...defaultRealSetup(), enabled: true } };
    const locked = ADVANCED_CONTROLS.filter((c) => isLockedByRealMode(c, on)).map((c) => c.key);
    for (const key of ['gravityScale', 'jumpFullHeightM', 'airControl', 'arenaSizeScale', 'wallHeightM', 'wallRestitution', 'ringOutDelayS', 'roundTimeLimitS', 'accelerationScale', 'topSpeedScale', 'dashCooldownS', 'dodgeCooldownS']) {
      expect(locked, key).toContain(key);
    }
    for (const control of ADVANCED_CONTROLS) {
      expect(isLockedByRealMode(control, off), control.key).toBe(false);
      if (control.kind === 'slider' && locked.includes(control.key)) {
        expect(control.disabledWhen?.(on), control.key).toBe(true);
        expect(control.disabledWhen?.(off) ?? false, control.key).toBe(false);
      }
    }
    // the unlocked ones stay editable
    expect(ADVANCED_CONTROLS.find((c) => c.key === 'knockbackScale')!.kind === 'slider' && (ADVANCED_CONTROLS.find((c) => c.key === 'knockbackScale') as { disabledWhen?: unknown }).disabledWhen).toBeFalsy();
    expect(writeAdvanced(on, 'knockbackScale', 2).rules.knockbackScale).toBe(2);
  });
});

describe('Bey Real autopilot', () => {
  const config = realModeConfigOf(REAL_BASE_PARAMS);
  const far = { x: 100, z: 100 };
  const at = (x: number, z: number, spinDir: 1 | -1 = 1) => autopilotIntent({ ...config, pursuit: 0 }, { position: { x, z }, opponentPosition: far, opponentSpin: 1, spinDir, side: 0, timeS: 0 });

  it('orbits the way the spin turns it: opposite spins orbit opposite ways', () => {
    const a = at(config.stageRadiusM * config.orbitRadiusFrac, 0, 1);
    const b = at(config.stageRadiusM * config.orbitRadiusFrac, 0, -1);
    expect(a.z).toBeGreaterThan(0.5);
    expect(b.z).toBeLessThan(-0.5);
  });

  it('keeps off the wall: near the edge it points back toward the centre', () => {
    const intent = at(config.stageRadiusM * 0.97, 0);
    expect(intent.x).toBeLessThan(-0.3);
  });

  it('comes back from the middle toward its orbit', () => {
    const intent = at(1, 0);
    expect(intent.x).toBeGreaterThan(0.3);
  });

  it('never asks for more than a full push', () => {
    for (const [x, z] of [[0.1, 0], [14, 0], [-9, 9], [3, -12]] as const) {
      const v = autopilotIntent({ ...config, pursuit: 1 }, { position: { x, z }, opponentPosition: { x: -x, z: -z }, opponentSpin: 0, spinDir: 1, side: 1, timeS: 7 });
      expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('pursuit pulls toward a tired opponent, and fades when the Beys touch', () => {
    const base = { position: { x: 0, z: 0 }, spinDir: 1 as const, side: 0 as const, timeS: 0, opponentSpin: 0 };
    const chasing = autopilotIntent({ ...config, pursuit: 1, orbitRadiusFrac: 0.2 }, { ...base, opponentPosition: { x: 8, z: 0 } });
    const none = autopilotIntent({ ...config, pursuit: 0, orbitRadiusFrac: 0.2 }, { ...base, opponentPosition: { x: 8, z: 0 } });
    expect(chasing.x).toBeGreaterThan(none.x);
    const close = autopilotIntent({ ...config, pursuit: 1, orbitRadiusFrac: 0.2 }, { ...base, opponentPosition: { x: 1.2, z: 0 } });
    const closeNone = autopilotIntent({ ...config, pursuit: 0, orbitRadiusFrac: 0.2 }, { ...base, opponentPosition: { x: 1.2, z: 0 } });
    expect(close.x).toBeCloseTo(closeNone.x, 6);
  });

  it('the player\'s share: no stick = the autopilot; influence 1 + full stick = the stick; in between mixes', () => {
    const auto = { x: 0, z: 1 };
    expect(blendSteering(auto, { x: 0, z: 0 }, 1)).toEqual(auto);
    expect(blendSteering(auto, { x: 1, z: 0 }, 0)).toEqual(auto);
    const full = blendSteering(auto, { x: 1, z: 0 }, 1);
    expect(full.x).toBeCloseTo(1, 9);
    expect(full.z).toBeCloseTo(0, 9);
    const half = blendSteering(auto, { x: 1, z: 0 }, 0.5);
    expect(half.x).toBeCloseTo(0.5, 9);
    expect(half.z).toBeCloseTo(0.5, 9);
    // a half-pushed stick counts for half as much
    const light = blendSteering(auto, { x: 0.5, z: 0 }, 1);
    expect(light.x).toBeCloseTo(0.5, 9);
  });
});

describe('Bey Real motion model', () => {
  const config = realModeConfigOf(REAL_BASE_PARAMS);
  const idle = { intent: { x: 0, z: 0 }, grounded: true, dt: 1 / 60, spin: 1, broken: false, stability: 100, charging: false, airControl: 0 };
  // a floor tilted like the funnel at x > 0: the normal leans toward the centre (-x)
  const slope = { x: -0.2, y: Math.sqrt(1 - 0.04), z: 0 };

  it('the bowl pulls toward the low point, harder on a steeper slope; flat ground pulls nothing', () => {
    const run = (n: { x: number; y: number; z: number } | null) => {
      const motion = new RealMotion({ ...config, dragPerS: 0, tipFrictionMps2: 0, precessionRadPerS: 0, wobbleAccelMps2: 0 }, 1);
      return motion.step({ ...idle, velocity: { x: 0, z: 0 }, floorNormal: n }).velocity;
    };
    expect(run(slope).x).toBeLessThan(0);
    expect(run({ x: -0.4, y: Math.sqrt(1 - 0.16), z: 0 }).x).toBeLessThan(run(slope).x);
    expect(run(null)).toEqual({ x: 0, z: 0 });
  });

  it('steering reaches the cruise speed in the asked direction, no faster than the steering force allows', () => {
    const motion = new RealMotion({ ...config, dragPerS: 0, tipFrictionMps2: 0, precessionRadPerS: 0, wobbleAccelMps2: 0, bowlPull: 0 }, 1);
    let v = { x: 0, z: 0 };
    const first = motion.step({ ...idle, velocity: v, intent: { x: 1, z: 0 }, floorNormal: null });
    expect(first.velocity.x).toBeLessThanOrEqual(config.steerAccelMps2 / 60 + 1e-9);
    expect(first.steerEffortMps2).toBeCloseTo(config.steerAccelMps2, 6);
    v = first.velocity;
    for (let i = 0; i < 240; i++) v = motion.step({ ...idle, velocity: v, intent: { x: 1, z: 0 }, floorNormal: null }).velocity;
    expect(v.x).toBeCloseTo(config.cruiseSpeedMps, 1);
    expect(Math.abs(v.z)).toBeLessThan(1e-6);
  });

  it('a spent spin cannot steer (no grip) and a Broken Bey barely can', () => {
    const accel = (extra: object) => new RealMotion({ ...config, dragPerS: 0, tipFrictionMps2: 0, precessionRadPerS: 0, wobbleAccelMps2: 0, bowlPull: 0 }, 1).step({ ...idle, velocity: { x: 0, z: 0 }, intent: { x: 1, z: 0 }, floorNormal: null, ...extra }).velocity.x;
    expect(accel({ spin: 0 })).toBeCloseTo(0, 9);
    expect(accel({ broken: true })).toBeCloseTo(accel({}) * 0.3, 6);
  });

  it('precession bends the path the way the spin turns, and the other way for the other spin', () => {
    const turn = (dir: 1 | -1) => new RealMotion({ ...config, dragPerS: 0, tipFrictionMps2: 0, wobbleAccelMps2: 0, bowlPull: 0, steerAccelMps2: 0 }, dir).step({ ...idle, velocity: { x: 10, z: 0 }, floorNormal: null }).velocity;
    expect(turn(1).z).toBeGreaterThan(0);
    expect(turn(-1).z).toBeLessThan(0);
    expect(Math.hypot(turn(1).x, turn(1).z)).toBeCloseTo(10, 6);
  });

  it('tip friction and drag slow a Bey that nobody drives, more with a tired spin; it comes to rest', () => {
    const slowed = (spin: number) => {
      const motion = new RealMotion({ ...config, bowlPull: 0, precessionRadPerS: 0, wobbleAccelMps2: 0, steerAccelMps2: 0 }, 1);
      return motion.step({ ...idle, spin, velocity: { x: 10, z: 0 }, floorNormal: null }).velocity.x;
    };
    expect(slowed(1)).toBeLessThan(10);
    expect(slowed(0.1)).toBeLessThan(slowed(1));
    const motion = new RealMotion({ ...config, bowlPull: 0, precessionRadPerS: 0, wobbleAccelMps2: 0, steerAccelMps2: 0 }, 1);
    let v = { x: 3, z: 0 };
    for (let i = 0; i < 60 * 30; i++) v = motion.step({ ...idle, velocity: v, floorNormal: null }).velocity;
    expect(Math.hypot(v.x, v.z)).toBeLessThan(0.05);
  });

  it('a tired spin wobbles sideways; a full one does not', () => {
    const side = (spin: number) => {
      const motion = new RealMotion({ ...config, bowlPull: 0, precessionRadPerS: 0, steerAccelMps2: 0, tipFrictionMps2: 0, dragPerS: 0 }, 1);
      let maxZ = 0;
      let v = { x: 8, z: 0 };
      for (let i = 0; i < 60; i++) {
        v = motion.step({ ...idle, spin, velocity: v, floorNormal: null }).velocity;
        maxZ = Math.max(maxZ, Math.abs(v.z));
      }
      return maxZ;
    };
    expect(side(1)).toBeLessThan(1e-9);
    expect(side(0.1)).toBeGreaterThan(0.05);
  });

  it('in the air only momentum, unless air control is on; winding up a Dash brakes hard', () => {
    const air = (airControl: number) => new RealMotion(config, 1).step({ ...idle, grounded: false, airControl, velocity: { x: 5, z: 0 }, intent: { x: 0, z: 1 }, floorNormal: null }).velocity;
    expect(air(0)).toEqual({ x: 5, z: 0 });
    expect(air(1).z).toBeGreaterThan(0);
    const braking = new RealMotion({ ...config, bowlPull: 0, precessionRadPerS: 0, wobbleAccelMps2: 0 }, 1).step({ ...idle, charging: true, velocity: { x: 10, z: 0 }, floorNormal: null }).velocity.x;
    const free = new RealMotion({ ...config, bowlPull: 0, precessionRadPerS: 0, wobbleAccelMps2: 0 }, 1).step({ ...idle, velocity: { x: 10, z: 0 }, floorNormal: null }).velocity.x;
    expect(braking).toBeLessThan(free);
  });

  it('is deterministic: the same inputs give the same numbers, and the wobble phase is its only memory', () => {
    const run = () => {
      const m = new RealMotion(config, -1);
      let v = { x: 6, z: 2 };
      for (let i = 0; i < 100; i++) v = m.step({ ...idle, spin: 0.2, velocity: v, intent: { x: 0.3, z: -0.7 }, floorNormal: slope }).velocity;
      return [v.x, v.z, m.getPhase()];
    };
    expect(run()).toEqual(run());
  });
});

describe('Bey Real spin drain', () => {
  it('replaces the classic drain: a share of the full spin per second, per metre and per unit of steering', () => {
    const drain = { decayPerS: 0.01, perMeter: 0.001, perSteer: 0.0001 };
    const stamina = new StaminaSystem(1, 1, 1, drain);
    stamina.tick(0, 1);
    expect(stamina.resource.fraction).toBeCloseTo(1 - 0.01, 9);
    stamina.tick(10, 1, 20);
    expect(stamina.resource.fraction).toBeCloseTo(1 - 0.01 - (0.01 + 0.01 + 0.002), 9);
    const classic = new StaminaSystem(1);
    classic.tick(0, 1);
    expect(classic.resource.fraction).toBeCloseTo(1 - 0.004, 9);
  });

  it('a Bey that stays at the base numbers lasts about 2 minutes just spinning (1 / 0.007 s)', () => {
    const stamina = new StaminaSystem(1, 1, 1, { decayPerS: REAL_BASE_PARAMS.spinDecayPerS, perMeter: 0, perSteer: 0 });
    for (let i = 0; i < 60 * 100; i++) stamina.tick(0, 1 / 60);
    expect(stamina.resource.fraction).toBeCloseTo(1 - 100 * 0.007, 4);
  });
});

describe('Bey Real assisted controller', () => {
  const noKeys: ControllerActions = { held: new Set([Action.MoveForward, Action.SteerLeft, Action.SteerRight, Action.Attack]), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0.2, jumpDriftHoldDurationSeconds: 0 };
  const bey = (x: number, z: number, fraction = 1) => ({ body: { translation: () => ({ x, y: 0, z }) }, stamina: { resource: { fraction } } }) as never;
  const inner = (actions: ControllerActions): CombatController => ({ sampleActions: () => actions });
  const ctx = { fixedDeltaSeconds: 1 / 60 };
  const config = realModeConfigOf(REAL_BASE_PARAMS);

  it('keeps the buttons, drops the steering keys, and writes a steering vector', () => {
    const c = new AssistedController(inner(noKeys), config, bey(10, 0), bey(-10, 0), 0, true);
    const out = c.sampleActions(ctx);
    expect(out.held.has(Action.Attack)).toBe(true);
    for (const key of [Action.MoveForward, Action.SteerLeft, Action.SteerRight, Action.MoveBackward]) expect(out.held.has(key), key).toBe(false);
    expect(out.attackHoldDurationSeconds).toBe(0.2);
    expect(out.moveIntent).toBeDefined();
    expect(Math.hypot(out.moveIntent!.x, out.moveIntent!.z)).toBeGreaterThan(0.3);
  });

  it('the player\'s stick takes its share; the AI side ignores whatever the wrapped controller asks for', () => {
    const stick: ControllerActions = { ...noKeys, moveIntent: { x: -1, z: 0 } };
    const person = new AssistedController(inner(stick), { ...config, influence: 1 }, bey(10, 0), bey(-10, 0), 0, true).sampleActions(ctx).moveIntent!;
    expect(person.x).toBeCloseTo(-1, 9);
    const ai = new AssistedController(inner(stick), { ...config, influence: 1 }, bey(10, 0), bey(-10, 0), 1, false).sampleActions(ctx).moveIntent!;
    expect(ai.x).toBeGreaterThan(-0.9);
  });

  it('a frozen tick (hitstop) does not advance the autopilot\'s clock', () => {
    const a = new AssistedController(inner(noKeys), config, bey(5, 0), bey(-5, 0), 0, false);
    const b = new AssistedController(inner(noKeys), config, bey(5, 0), bey(-5, 0), 0, false);
    for (let i = 0; i < 600; i++) a.sampleActions({ fixedDeltaSeconds: 1 / 60, simulationFrozen: true });
    expect(a.sampleActions(ctx).moveIntent).toEqual(b.sampleActions(ctx).moveIntent);
  });
});

describe('Bey Real cameras', () => {
  const frame = (dt = 1 / 60) => ({ dt, first: { x: 6, y: 0, z: 0 }, second: { x: -6, y: 0, z: 2 }, arenaRadiusM: 15 });

  it('lists the three choices: original, the mode\'s own, free', () => {
    expect([...REAL_CAMERA_MODES]).toEqual(['original', 'real', 'free']);
  });

  it('the mode\'s camera is high, looks at the arena, and scales with the stage', () => {
    const camera = new THREE.PerspectiveCamera();
    new RealModeCamera().apply(camera, frame());
    expect(camera.position.y).toBeGreaterThan(15);
    const small = new THREE.PerspectiveCamera();
    new RealModeCamera().apply(small, { ...frame(), arenaRadiusM: 7.5 });
    expect(small.position.y).toBeCloseTo(camera.position.y / 2, 6);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    expect(dir.y).toBeLessThan(-0.5);
  });

  it('follows the fight slowly instead of jumping', () => {
    const cam = new RealModeCamera();
    const camera = new THREE.PerspectiveCamera();
    cam.apply(camera, { ...frame(), first: { x: 0, y: 0, z: 0 }, second: { x: 0, y: 0, z: 0 } });
    const x0 = camera.position.x;
    cam.apply(camera, { ...frame(1 / 60), first: { x: 20, y: 0, z: 0 }, second: { x: 20, y: 0, z: 0 } });
    expect(camera.position.x - x0).toBeGreaterThan(0);
    expect(camera.position.x - x0).toBeLessThan(0.5);
  });

  it('the free camera orbits on drag, zooms on the wheel, resets on a double click, and lets go of the window when disposed', () => {
    const listeners = new Map<string, EventListener[]>();
    const target = {
      addEventListener: (type: string, fn: EventListener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      removeEventListener: (type: string, fn: EventListener) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
    } as unknown as Window;
    const free = new FreeOrbitCamera(target);
    const fire = (type: string, event: object) => (listeners.get(type) ?? []).forEach((fn) => fn(event as Event));
    const start = free.getState();
    fire('pointerdown', { clientX: 100, clientY: 100, target: { closest: () => null } });
    fire('pointermove', { clientX: 200, clientY: 140 });
    fire('pointerup', {});
    fire('pointermove', { clientX: 400, clientY: 400 }); // not dragging any more
    const moved = free.getState();
    expect(moved.yaw).not.toBe(start.yaw);
    expect(moved.pitch).toBeGreaterThan(start.pitch);
    fire('wheel', { deltaY: 200, preventDefault: () => undefined });
    expect(free.getState().distanceRadii).toBeGreaterThan(moved.distanceRadii);
    // a press on a button is the button's, not the camera's
    const before = free.getState();
    fire('pointerdown', { clientX: 0, clientY: 0, target: { closest: () => ({}) } });
    fire('pointermove', { clientX: 300, clientY: 300 });
    expect(free.getState()).toEqual(before);
    fire('dblclick', {});
    expect(free.getState()).toEqual(start);
    const camera = new THREE.PerspectiveCamera();
    free.apply(camera, frame());
    expect(camera.position.length()).toBeGreaterThan(15);
    free.dispose();
    for (const list of listeners.values()) expect(list).toHaveLength(0);
  });
});
