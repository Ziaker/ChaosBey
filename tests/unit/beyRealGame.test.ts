// Bey Real in the game (0.59.0, owner 2026-10-09): the tuning list and its base preset, the setup, what the sliders turn into in
// the match's rules, the motion model (pure physics since 0.64.0: no autopilot), the player's lean, the assisted controller and the
// cameras.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ADVANCED_CONTROLS, isLockedByRealMode, isModified, isSharedWithRealMode, readAdvanced, writeAdvanced } from '../../src/app/frontend/advancedControls';
import { createDefaultMatchSetup, defaultRealSetup, isRealMode, loadLastSetup, matchConfigFor, sanitizeRealSetup, saveLastSetup, activeRuleLines } from '../../src/app/frontend/matchSetup';
import { AssistedController, leanOf } from '../../src/bey/real/AssistedController';
import { RealMotion, rollingSpeedMps } from '../../src/bey/real/RealMotion';
import { naturalBowlGravity } from '../../src/bey/real/realBowl';
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
import { REAL_OWNED_RULE_KEYS, labEquivalentBowlDepthM, realMatchOverrides } from '../../src/bey/real/realMatchRules';
import { StaminaSystem } from '../../src/bey/stamina/StaminaSystem';
import { FreeOrbitCamera, RealModeCamera } from '../../src/camera/real/RealCameras';
import { REAL_CAMERA_MODES } from '../../src/camera/real/RealCameraModes';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';

/** The owner's tuned numbers, as pasted on 2026-10-09 ("esse preset atual … é pra ser o base"), with the same day's request for more movement. */
const OWNER_JSON_0_63 = {
  influence: 0.75, steerAccelMps2: 40, cruiseSpeedMps: 18, pursuit: 1, orbitRadiusFrac: 0.8, orbitBreath: 0.35, orbitBreathRadPerS: 0.7, cruiseMinShare: 0.75, bowlPull: 20, dragPerS: 0.1, tipFrictionMps2: 0.7, precessionRadPerS: 0.9,
  spinDecayPerS: 0.007, spinMoveLossPerM: 0.00035, spinSteerLoss: 0.00025, wobbleSpin: 0.35, wobbleAccelMps2: 10, massSecond: 1, sameSpin: 0, restitutionLow: 0.7,
  restitutionHigh: 0.92, rimFriction: 0.4, spinExchange: 0.012, hitSpinLoss: 0.004, rubSpinLoss: 0.0016, hitStability: 0.6, wallRestitution: 0.9, wallSpinLoss: 0.0016,
  dashMinSpeedMps: 10, dashMaxSpeedMps: 30, dashChargeMaxS: 1.6, dashDurationS: 0.8, dashCooldownS: 1.5, dashSnapRadPerS: 40, dashSnapWindowS: 0.08, dashLockRadPerS: 5,
  dashMassBoost: 1.8, dashStabilityMin: 10, dashStabilityMax: 25, dashSpinCost: 0.012, dashWhiffRecoveryS: 1.6, circularRadiusM: 1.55, circularDurationS: 0.35,
  circularRecoveryS: 0.95, circularLaunchMps: 9, circularLaunchUpMps: 7, circularKeepFraction: 0.65, circularStability: 12, dodgeSpeedMps: 22, dodgeBurstS: 0.17,
  dodgeInvulnS: 0.5, dodgeCooldownS: 3, dodgePerfectS: 0.2, dodgeSpinCost: 0.01, jumpSpeedMps: 10.5, gravityMps2: 31, airControl: 0, jumpCooldownS: 0.4,
  stageRadiusM: 15, bowlDepthScale: 1, wallHeightM: 1.6, ringOutDelayS: 0.6, timeLimitS: 150, gameSpeed: 1, stabilityRegenPerS: 5, brokenS: 2.4, aiAggression: 1, aiSkill: 0.85,
};

/**
 * 0.64.0 (owner, 2026-10-10: "os beys estão só sendo controlados por uma IA … MUITO lentos … 5 VEZES MAIS RÁPIDOS"; then "a ideia
 * é eles irem pro centro e depois voltarem … seguindo uma física coesa"): the autopilot's values are gone (pursuit, the orbit's
 * breathing) and the motion is physics only. Kept as the Turbo (×5) preset.
 */
const TURBO_0_64: RealParams = {
  ...(Object.fromEntries(Object.entries(OWNER_JSON_0_63).filter(([k]) => !['pursuit', 'orbitBreath', 'orbitBreathRadPerS'].includes(k))) as unknown as RealParams),
  cruiseSpeedMps: 90, steerAccelMps2: 1000, orbitRadiusFrac: 0.8, bowlPull: 1, dragPerS: 0.2, tipFrictionMps2: 17.5, crossGripPerS: 1.5, precessionRadPerS: 1.5,
  spinMoveLossPerM: 0.00007, spinSteerLoss: 0.00001, wobbleAccelMps2: 250,
  spinExchange: 0.00048, hitSpinLoss: 0.00016, rubSpinLoss: 0.000064, hitStability: 0.024, wallSpinLoss: 0.000064,
  dashMinSpeedMps: 50, dashMaxSpeedMps: 130, dashDurationS: 0.3, dashLockRadPerS: 25, circularLaunchMps: 45, dodgeSpeedMps: 60,
};

/**
 * 0.65.0 (owner, 2026-10-11: "os beys agora estão mil vezes mais rapidos do que deviam … o modo pesado e inercial está mais próximo
 * do que eu almejo, só precisa ser no mínimo 15% mais rapido nesse modo"): the 0.64.0 "Pesado e inercial" preset (rolling 45 m/s,
 * grip 300, bowl ×1.3, spin decay 0.0035, wobble 125) with the rolling speed 15% up (52 m/s); the attacks and what a hit costs follow
 * that speed (k = 52/18 over the owner's own numbers: speeds ×k, per-metre costs ÷k, per-hit costs and per-unit-of-effort ÷k²).
 */
const K = 52 / 18;
const BASE_0_65: RealParams = {
  ...TURBO_0_64,
  cruiseSpeedMps: 52, steerAccelMps2: 300, bowlPull: 1.3, spinDecayPerS: 0.0035, wobbleAccelMps2: 125, crossGripPerS: 0.5,
  spinMoveLossPerM: 0.00012, spinSteerLoss: 0.00003,
  spinExchange: 0.00144, hitSpinLoss: 0.00048, rubSpinLoss: 0.000192, hitStability: 0.072, wallSpinLoss: 0.000192,
  dashMinSpeedMps: 29, dashMaxSpeedMps: 87, dashLockRadPerS: 14, circularLaunchMps: 26,
};

describe('Bey Real tuning', () => {
  it('the base preset is the 0.64.0 "Pesado e inercial", 15% faster, with the attacks and the hit costs at that speed', () => {
    expect({ ...REAL_BASE_PARAMS }).toEqual(BASE_0_65);
    expect(realPresetValues('base')).toEqual(BASE_0_65);
    expect(matchingRealPreset(BASE_0_65)).toBe('base');
    const b = REAL_BASE_PARAMS;
    expect(b.cruiseSpeedMps, 'at least 15% over the 45 m/s of "Pesado e inercial"').toBeGreaterThanOrEqual(45 * 1.15);
    const o = OWNER_JSON_0_63;
    expect(b.dashMinSpeedMps).toBeCloseTo(o.dashMinSpeedMps * K, 0);
    expect(b.dashMaxSpeedMps).toBeCloseTo(o.dashMaxSpeedMps * K, 0);
    expect(b.circularLaunchMps).toBeCloseTo(o.circularLaunchMps * K, 0);
    expect(b.spinMoveLossPerM).toBeCloseTo(o.spinMoveLossPerM / K, 5);
    for (const key of ['hitSpinLoss', 'rubSpinLoss', 'spinExchange', 'hitStability', 'wallSpinLoss', 'spinSteerLoss'] as const) expect(b[key] / (o[key] / K ** 2), key).toBeCloseTo(1, 1);
    // the timers the player plays against are the owner's
    for (const key of ['dashChargeMaxS', 'dashCooldownS', 'dashWhiffRecoveryS', 'dodgeCooldownS', 'dodgePerfectS', 'circularDurationS', 'timeLimitS'] as const) expect(b[key], key).toBe(o[key]);
    // the autopilot's values are gone
    for (const key of ['pursuit', 'orbitBreath', 'orbitBreathRadPerS']) expect(key in b, key).toBe(false);
  });

  it('the 0.64.0 base lives on as the Turbo (×5) preset', () => {
    expect(realPresetValues('turbo')).toEqual(TURBO_0_64);
  });

  it('the "Velocidade antiga" preset is the same physics at the old pace', () => {
    const slow = realPresetValues('slow');
    expect(slow.cruiseSpeedMps).toBe(18);
    expect(slow.dashMaxSpeedMps).toBe(30);
    expect(slow.hitStability).toBe(0.6);
  });

  it('every value has one spec, inside its own range, with a note of its own and a group', () => {
    const keys = Object.keys(BASE_0_65).sort();
    expect(keys, '66 values: the owner\'s 68, less the autopilot\'s three, plus the tip\'s bite across the slope').toHaveLength(66);
    expect(REAL_PARAM_SPEC.map((s) => s.key).sort()).toEqual(keys);
    for (const spec of REAL_PARAM_SPEC) {
      expect(spec.min, spec.key).toBeLessThan(spec.max);
      expect(BASE_0_65[spec.key], spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(BASE_0_65[spec.key], spec.key).toBeLessThanOrEqual(spec.max);
      expect(spec.note.length, `${spec.key} has an explanation`).toBeGreaterThan(20);
      expect(REAL_GROUP_ORDER).toContain(spec.group);
      expect(spec.format(BASE_0_65[spec.key])).not.toContain('NaN');
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
    expect(matchingRealPreset({ ...REAL_BASE_PARAMS, cruiseSpeedMps: 77 })).toBeNull();
  });

  it('sanitizing clamps, ignores junk and falls back to the base', () => {
    const p = sanitizeRealParams({ influence: 5, cruiseSpeedMps: -2, bowlPull: 'x', crossGripPerS: Number.NaN, pursuit: 1 } as never);
    expect(p.influence).toBe(1);
    expect(p.cruiseSpeedMps).toBe(10);
    expect(p.bowlPull).toBe(REAL_BASE_PARAMS.bowlPull);
    expect(p.crossGripPerS).toBe(REAL_BASE_PARAMS.crossGripPerS);
    expect('pursuit' in p, 'an old save\'s autopilot value is dropped').toBe(false);
    expect(sanitizeRealParams(null)).toEqual({ ...REAL_BASE_PARAMS });
  });

  it('the Pregame lists only live sliders, every group in order, and the engine config carries the live movement values', () => {
    const live = liveRealSpecs();
    expect(live.length).toBeGreaterThan(25);
    const config = realModeConfigOf(REAL_BASE_PARAMS);
    for (const key of Object.keys(config) as (keyof typeof config)[]) expect(typeof config[key]).toBe('number');
    for (const key of ['influence', 'steerAccelMps2', 'cruiseSpeedMps', 'crossGripPerS', 'orbitRadiusFrac', 'bowlPull', 'dragPerS', 'tipFrictionMps2', 'precessionRadPerS', 'wobbleSpin', 'wobbleAccelMps2', 'spinDecayPerS', 'spinMoveLossPerM', 'spinSteerLoss'] as const) {
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
    expect(config.dodgeDistanceScale).toBeCloseTo(60 / 12.6, 6);
    expect(config.circularLaunchForce).toBeCloseTo(26 / 9, 6);
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
    const setup = { ...createDefaultMatchSetup(), real: { enabled: true, camera: 'free' as const, presetId: 'custom', params: { ...REAL_BASE_PARAMS, influence: 0.4, bowlPull: 2.5 } } };
    saveLastSetup(setup, storage);
    expect(loadLastSetup(storage)!.real).toEqual(setup.real);
    const raw = JSON.parse(store.get([...store.keys()][0]!)!);
    delete raw.real;
    store.set([...store.keys()][0]!, JSON.stringify(raw));
    expect(loadLastSetup(storage)!.real).toEqual(defaultRealSetup());
    expect(sanitizeRealSetup({ enabled: 'yes', camera: 'sideways', params: { influence: 9 } })).toMatchObject({ enabled: false, camera: 'real', params: { influence: 1 } });
  });

  it('the arena controls stay available in Bey Real: they edit the mode\'s own values, and the match follows them', () => {
    const off = createDefaultMatchSetup();
    const on = { ...off, real: { ...defaultRealSetup(), enabled: true } };
    for (const key of ['arenaSizeScale', 'arenaBowlDepthM', 'wallHeightM', 'wallRestitution', 'gameSpeed'] as const) {
      const control = ADVANCED_CONTROLS.find((c) => c.key === key)!;
      expect(isLockedByRealMode(control, on), key).toBe(false);
      expect(control.kind === 'slider' && control.disabledWhen?.(on), key).toBeFalsy();
    }
    const bigger = writeAdvanced(on, 'arenaSizeScale', 1);
    expect(bigger.real!.params.stageRadiusM).toBeCloseTo(36, 6);
    expect(readAdvanced(bigger, 'arenaSizeScale')).toBeCloseTo(1, 6);
    expect(bigger.rules.arenaSizeScale).toBe(off.rules.arenaSizeScale); // the classic value is untouched
    const deep = writeAdvanced(on, 'arenaBowlDepthM', 4);
    expect(readAdvanced(deep, 'arenaBowlDepthM')).toBeCloseTo(4, 6);
    const tall = writeAdvanced(on, 'wallHeightM', 10);
    expect(tall.real!.params.wallHeightM).toBe(10);
    expect(matchConfigFor(tall).arenaWallHeightM).toBe(10);
    expect(matchConfigFor(bigger).arenaSizeScale).toBeCloseTo(1, 6);
    expect(matchConfigFor(deep).arenaBowlDepthM).toBeCloseTo(4, 6);
    expect(matchConfigFor(writeAdvanced(on, 'gameSpeed', 1.5)).gameSpeed).toBe(1.5);
    // off: the classic values, untouched by the mode
    expect(writeAdvanced(off, 'wallHeightM', 9).arena.geometry.wallHeightM).toBe(9);
    expect(isModified(on, 'arenaSizeScale')).toBe(false);
    expect(isModified(bigger, 'arenaSizeScale')).toBe(true);
  });

  it('says so in the active rules', () => {
    const setup = { ...createDefaultMatchSetup(), real: { ...defaultRealSetup(), enabled: true } };
    expect(activeRuleLines(setup).some((l) => l.startsWith('Bey Real'))).toBe(true);
    expect(activeRuleLines(createDefaultMatchSetup()).some((l) => l.startsWith('Bey Real'))).toBe(false);
  });

  it('while the mode is on, the classic sliders edit the mode\'s own values; only the ones it has no mechanism for are locked', () => {
    const off = createDefaultMatchSetup();
    const on = { ...off, real: { ...defaultRealSetup(), enabled: true } };
    const locked = ADVANCED_CONTROLS.filter((c) => isLockedByRealMode(c, on)).map((c) => c.key).sort();
    expect(locked).toEqual(['bodyContactControlLossScale', 'highSpeedControl', 'momentumDecayS', 'momentumFillS', 'momentumGain', 'turnSpeedRetention']);
    for (const control of ADVANCED_CONTROLS) {
      expect(isLockedByRealMode(control, off), control.key).toBe(false);
      if (control.kind === 'slider' && locked.includes(control.key)) {
        expect(control.disabledWhen?.(on), control.key).toBe(true);
        expect(control.disabledWhen?.(off) ?? false, control.key).toBe(false);
      }
    }
    // every rule the mode owns is either a shared control or locked: no classic slider silently does nothing
    for (const key of REAL_OWNED_RULE_KEYS) {
      const control = ADVANCED_CONTROLS.find((c) => c.key === key);
      if (!control) continue;
      expect(isSharedWithRealMode(control, on) || isLockedByRealMode(control, on), key).toBe(true);
    }
    // the multipliers count from the mode's base: ×1 = base, and they reach the match
    expect(readAdvanced(on, 'topSpeedScale')).toBeCloseTo(1, 9);
    expect(isModified(on, 'topSpeedScale')).toBe(false);
    const faster = writeAdvanced(on, 'topSpeedScale', 1.5);
    expect(faster.real!.params.cruiseSpeedMps).toBeCloseTo(REAL_BASE_PARAMS.cruiseSpeedMps * 1.5, 9);
    expect(matchConfigFor(faster).real!.cruiseSpeedMps).toBeCloseTo(REAL_BASE_PARAMS.cruiseSpeedMps * 1.5, 9);
    expect(isModified(faster, 'topSpeedScale')).toBe(true);
    expect(faster.rules.topSpeedScale, 'the classic value is untouched').toBe(off.rules.topSpeedScale);
    expect(writeAdvanced(on, 'accelerationScale', 0.5).real!.params.steerAccelMps2).toBeCloseTo(REAL_BASE_PARAMS.steerAccelMps2 * 0.5, 9);
    expect(writeAdvanced(on, 'bodyCollisionDamage', 0.5).real!.params.hitStability).toBeCloseTo(REAL_BASE_PARAMS.hitStability * 0.5, 9);
    expect(writeAdvanced(on, 'circularLaunchForce', 0.5).real!.params.circularLaunchMps).toBeCloseTo(REAL_BASE_PARAMS.circularLaunchMps * 0.5, 9);
    // momentum loss on collision = 1 − the bounce: more loss, less explosive contacts
    const soft = writeAdvanced(on, 'momentumLossOnCollision', 0.5);
    expect(soft.real!.params.restitutionHigh).toBeCloseTo(0.5, 9);
    expect(soft.real!.params.restitutionLow).toBeLessThan(0.5);
    // the same quantity: gravity keeps the jump height (as in the classic slider), the jump height sets the launch speed
    const apex = (p: RealParams) => (p.jumpSpeedMps ** 2) / (2 * p.gravityMps2);
    const heavy = writeAdvanced(on, 'gravityScale', 3.5);
    expect(heavy.real!.params.gravityMps2).toBeCloseTo(3.5 * 10.5, 9);
    expect(apex(heavy.real!.params)).toBeCloseTo(apex(REAL_BASE_PARAMS), 6);
    expect(apex(writeAdvanced(on, 'jumpFullHeightM', 2).real!.params)).toBeCloseTo(2, 6);
    expect(writeAdvanced(on, 'dashCooldownS', 2.5).real!.params.dashCooldownS).toBe(2.5);
    expect(writeAdvanced(on, 'funnelPull', 2).real!.params.bowlPull).toBe(2);
    expect(writeAdvanced(on, 'roundTimeLimitS', 90).real!.params.timeLimitS).toBe(90);
    // the classic ones stay editable as always
    expect(writeAdvanced(on, 'knockbackScale', 2).rules.knockbackScale).toBe(2);
  });
});

describe('Bey Real: nobody steers', () => {
  const config = realModeConfigOf(REAL_BASE_PARAMS);

  it('the player\'s lean is the stick × influence; no stick or influence 0 is no lean', () => {
    expect(leanOf(undefined, 1)).toEqual({ x: 0, z: 0 });
    expect(leanOf({ x: 0, z: 0 }, 1)).toEqual({ x: 0, z: 0 });
    expect(leanOf({ x: 1, z: 0 }, 0)).toEqual({ x: 0, z: 0 });
    expect(leanOf({ x: 1, z: 0 }, 0.75).x).toBeCloseTo(0.75, 9);
    expect(leanOf({ x: 0.5, z: 0 }, 1).x, 'a half-pushed stick leans half as much').toBeCloseTo(0.5, 9);
    expect(Math.hypot(leanOf({ x: 3, z: 4 }, 1).x, leanOf({ x: 3, z: 4 }, 1).z)).toBeCloseTo(1, 9);
  });

  it('the bowl is as strong as a Bey at the rolling speed needs to climb to "Até onde sobe a rampa" and turn round', () => {
    const g = naturalBowlGravity(config);
    // ½v² = g·h at the climb's height (h = D·f^1.3 on the mode's own funnel)
    const depth = 7 * (15 / 36) ** 1.3;
    expect(0.5 * config.cruiseSpeedMps ** 2).toBeCloseTo(g * depth * config.orbitRadiusFrac ** 1.3, 6);
    // twice the speed needs four times the bowl to turn round in the same place
    expect(naturalBowlGravity({ ...config, cruiseSpeedMps: config.cruiseSpeedMps / 2 }) * 4).toBeCloseTo(g, 6);
    // a shorter climb needs a stronger bowl
    expect(naturalBowlGravity({ ...config, orbitRadiusFrac: 0.4 })).toBeGreaterThan(g);
  });
});

describe('Bey Real motion model', () => {
  const config = realModeConfigOf(REAL_BASE_PARAMS);
  const idle = { intent: { x: 0, z: 0 }, grounded: true, dt: 1 / 60, spin: 1, broken: false, stability: 100, airControl: 0, floorHeightM: 0 };
  // a floor tilted like the funnel at x > 0: the normal leans toward the centre (-x)
  const slope = { x: -0.2, y: Math.sqrt(1 - 0.04), z: 0 };
  const quiet = { dragPerS: 0, tipFrictionMps2: 0, precessionRadPerS: 0, wobbleAccelMps2: 0, crossGripPerS: 0 };

  it('the bowl pulls toward the low point, harder on a steeper slope; flat ground pulls nothing', () => {
    const run = (n: { x: number; y: number; z: number } | null) => new RealMotion({ ...config, ...quiet }, 1).step({ ...idle, velocity: { x: 0, z: 0 }, floorNormal: n }).velocity;
    expect(run(slope).x).toBeLessThan(0);
    expect(run({ x: -0.4, y: Math.sqrt(1 - 0.16), z: 0 }).x).toBeLessThan(run(slope).x);
    expect(run(null)).toEqual({ x: 0, z: 0 });
  });

  it('a Bey at rest gets no push from anyone: nothing picks a direction for it', () => {
    const out = new RealMotion(config, 1).step({ ...idle, velocity: { x: 0, z: 0 }, floorNormal: null });
    expect(out.velocity).toEqual({ x: 0, z: 0 });
  });

  it('the tip only pushes along the way of travel, toward the energy the spin sustains — never turns the Bey', () => {
    const motion = new RealMotion({ ...config, ...quiet }, 1);
    // slow at the low point: it speeds up along its own line
    const slow = motion.step({ ...idle, velocity: { x: 10, z: 0 }, floorNormal: null }).velocity;
    expect(slow.x).toBeGreaterThan(10);
    expect(slow.z).toBeCloseTo(0, 9);
    // faster than it can sustain: the tip brakes it, still along its line
    const fast = new RealMotion({ ...config, ...quiet }, 1).step({ ...idle, velocity: { x: 0, z: -150 }, floorNormal: null }).velocity;
    expect(fast.z).toBeGreaterThan(-150);
    expect(fast.x).toBeCloseTo(0, 9);
    // high up the slope at the rolling speed it already has more energy than the spin sustains: no push, a brake
    const high = new RealMotion({ ...config, ...quiet }, 1).step({ ...idle, velocity: { x: 0, z: config.cruiseSpeedMps }, floorNormal: null, floorHeightM: 1 }).velocity;
    expect(high.z).toBeLessThan(config.cruiseSpeedMps);
  });

  it('dropped from the rim it swings through the centre and back up the other side, again and again (no circle)', () => {
    // a 1-D funnel cut through the centre: h = D·(|x|/R)^1.3, the same the arena has
    const depth = 7 * (15 / 36) ** 1.3;
    const R = config.stageRadiusM;
    const motion = new RealMotion(config, 1);
    let x = 11;
    let z = 0;
    let v = { x: 0, z: 0 };
    let crossings = 0;
    let maxOut = 0;
    let minR = Infinity;
    for (let i = 0; i < 60 * 6; i++) {
      const r = Math.hypot(x, z);
      const s = 1.3 * (depth / R) * (r / R) ** 0.3;
      const n = r > 1e-6 ? { x: (-s * x) / r / Math.hypot(s, 1), y: 1 / Math.hypot(s, 1), z: (-s * z) / r / Math.hypot(s, 1) } : null;
      const before = x;
      v = motion.step({ ...idle, velocity: v, floorNormal: n, floorHeightM: depth * (r / R) ** 1.3 }).velocity;
      x += v.x / 60;
      z += v.z / 60;
      if (Math.sign(before) !== Math.sign(x)) crossings++;
      maxOut = Math.max(maxOut, Math.hypot(x, z));
      if (i > 60) minR = Math.min(minR, Math.hypot(x, z));
    }
    expect(crossings, 'through the centre many times').toBeGreaterThan(6);
    expect(maxOut, 'never out of the stage').toBeLessThan(R);
    expect(minR, 'it passes right by the low point').toBeLessThan(3);
  });

  it('the tip bites across the slope: sliding round the arena is braked, sliding up and down is not', () => {
    const across = new RealMotion({ ...quiet, ...config, dragPerS: 0, tipFrictionMps2: 0, precessionRadPerS: 0, wobbleAccelMps2: 0, bowlPull: 0, steerAccelMps2: 0 }, 1)
      .step({ ...idle, velocity: { x: 0, z: 20 }, floorNormal: slope }).velocity;
    const upDown = new RealMotion({ ...quiet, ...config, dragPerS: 0, tipFrictionMps2: 0, precessionRadPerS: 0, wobbleAccelMps2: 0, bowlPull: 0, steerAccelMps2: 0 }, 1)
      .step({ ...idle, velocity: { x: 20, z: 0 }, floorNormal: slope }).velocity;
    expect(across.z).toBeLessThan(20);
    expect(upDown.x).toBeCloseTo(20, 9);
  });

  it('the lean is a force capped by the grip: it bends the path, it does not replace the velocity', () => {
    const motion = new RealMotion({ ...config, ...quiet }, 1);
    const out = motion.step({ ...idle, velocity: { x: 0, z: 50 }, intent: { x: 1, z: 0 }, floorNormal: null });
    expect(out.velocity.x).toBeCloseTo(config.steerAccelMps2 / 60, 6);
    expect(out.velocity.z, 'the momentum is still there').toBeGreaterThan(45);
  });

  it('a spent spin has no grip (no drive, no lean) and a Broken Bey barely has', () => {
    const lean = (extra: object) => new RealMotion({ ...config, ...quiet }, 1).step({ ...idle, velocity: { x: 0, z: 0 }, intent: { x: 1, z: 0 }, floorNormal: null, ...extra }).velocity.x;
    expect(lean({ spin: 0 })).toBeCloseTo(0, 9);
    expect(lean({ broken: true })).toBeCloseTo(lean({}) * 0.3, 6);
  });

  it('precession bends the path the way the spin turns, and the other way for the other spin', () => {
    const turn = (dir: 1 | -1) => new RealMotion({ ...config, dragPerS: 0, tipFrictionMps2: 0, wobbleAccelMps2: 0, bowlPull: 0, steerAccelMps2: 0 }, dir).step({ ...idle, velocity: { x: 10, z: 0 }, floorNormal: null }).velocity;
    expect(turn(1).z).toBeGreaterThan(0);
    expect(turn(-1).z).toBeLessThan(0);
    expect(Math.hypot(turn(1).x, turn(1).z)).toBeCloseTo(10, 6);
  });

  it('tip friction and drag slow a Bey the tip does not drive, more with a tired spin; it comes to rest', () => {
    const slowed = (spin: number) => new RealMotion({ ...config, bowlPull: 0, precessionRadPerS: 0, wobbleAccelMps2: 0, steerAccelMps2: 0 }, 1).step({ ...idle, spin, velocity: { x: 10, z: 0 }, floorNormal: null }).velocity.x;
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

  it('in the air only momentum, unless air control is on', () => {
    const air = (airControl: number) => new RealMotion(config, 1).step({ ...idle, grounded: false, airControl, velocity: { x: 5, z: 0 }, intent: { x: 0, z: 1 }, floorNormal: null }).velocity;
    expect(air(0)).toEqual({ x: 5, z: 0 });
    expect(air(1).z).toBeGreaterThan(0);
  });

  it('a low spin still rolls as fast as "Rolagem que sobra com giro baixo" says', () => {
    expect(rollingSpeedMps(config, 1)).toBe(config.cruiseSpeedMps);
    const tired = (cruiseMinShare: number) => rollingSpeedMps({ ...config, cruiseMinShare }, 0.2);
    expect(tired(1)).toBe(config.cruiseSpeedMps);
    expect(tired(1)).toBeGreaterThan(tired(0.5));
    expect(tired(0.5)).toBeGreaterThan(tired(0));
  });

  it('is deterministic: the same inputs give the same numbers, and the wobble phase is its only memory', () => {
    const run = () => {
      const m = new RealMotion(config, -1);
      let v = { x: 6, z: 2 };
      for (let i = 0; i < 100; i++) v = m.step({ ...idle, spin: 0.2, velocity: v, intent: { x: 0.3, z: -0.7 }, floorNormal: slope, floorHeightM: 1 }).velocity;
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

  it('a Bey that stays at the base numbers lasts about 5 minutes just spinning (1 / 0.0035 s)', () => {
    const stamina = new StaminaSystem(1, 1, 1, { decayPerS: REAL_BASE_PARAMS.spinDecayPerS, perMeter: 0, perSteer: 0 });
    for (let i = 0; i < 60 * 100; i++) stamina.tick(0, 1 / 60);
    expect(stamina.resource.fraction).toBeCloseTo(1 - 100 * 0.0035, 4);
  });
});

describe('Bey Real assisted controller', () => {
  const noKeys: ControllerActions = { held: new Set([Action.MoveForward, Action.SteerLeft, Action.SteerRight, Action.Attack]), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0.2, jumpDriftHoldDurationSeconds: 0 };
  const inner = (actions: ControllerActions): CombatController => ({ sampleActions: () => actions });
  const ctx = { fixedDeltaSeconds: 1 / 60 };
  const config = realModeConfigOf(REAL_BASE_PARAMS);

  it('keeps the buttons and drops the steering keys; with no stick nobody steers', () => {
    const out = new AssistedController(inner(noKeys), config, true).sampleActions(ctx);
    expect(out.held.has(Action.Attack)).toBe(true);
    for (const key of [Action.MoveForward, Action.SteerLeft, Action.SteerRight, Action.MoveBackward]) expect(out.held.has(key), key).toBe(false);
    expect(out.attackHoldDurationSeconds).toBe(0.2);
    expect(out.moveIntent).toEqual({ x: 0, z: 0 });
  });

  it('the player\'s stick leans the top by its influence; the AI side never steers, whatever the wrapped AI asks for', () => {
    const stick: ControllerActions = { ...noKeys, moveIntent: { x: -1, z: 0 } };
    const person = new AssistedController(inner(stick), { ...config, influence: 0.6 }, true).sampleActions(ctx).moveIntent!;
    expect(person.x).toBeCloseTo(-0.6, 9);
    const ai = new AssistedController(inner(stick), { ...config, influence: 1 }, false).sampleActions(ctx).moveIntent!;
    expect(ai).toEqual({ x: 0, z: 0 });
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
