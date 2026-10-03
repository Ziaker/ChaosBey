// Owner, 2026-10-02 (Lote 6, item 10): the tilt. Render-only attitude (SpinController), through the real tickMatch().
// - leanStrength, speedTilt and maxTilt of every direction (A/B/C) are 25% smaller.
// - Wobble and precession only show below 70% Stamina or Stability, ramping in to full at 0, with no jump; above it
//   the Bey is steady and its axis does not circle. Impacts still give a momentary wobble that decays.
// - None of it feeds the physics: the attitude stays out of the state hash, and gameplay is identical.

import { describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { LEAN_SCALE, MOTION_DIRECTIONS } from '../../src/bey/motion/MotionPresets';
import { SpinController } from '../../src/bey/spin/SpinController';
import { AXIS_UNREST_START_FRACTION, axisUnrest } from '../../src/bey/spin/SpinTuning';
import { FULL_PHYSICAL_CONDITION } from '../../src/bey/stamina/StaminaSystem';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const DEG = 180 / Math.PI;

describe('lean −25% on every motion direction (owner, 2026-10-02)', () => {
  it('A/B/C leanStrength, speedTilt and maxTilt are 0.75 × the former values', () => {
    expect(LEAN_SCALE).toBe(0.75);
    const former = { A: [0.01, 0.002, 18], B: [0.022, 0.006, 35], C: [0.04, 0.012, 48] } as const;
    for (const id of ['A', 'B', 'C'] as const) {
      const p = MOTION_DIRECTIONS[id].params;
      expect([p.leanStrength, p.speedTilt, p.maxTilt].map((v, i) => v / former[id][i]!)).toEqual([0.75, 0.75, 0.75].map((v) => expect.closeTo(v, 12)));
    }
  });
});

describe('wobble and precession only below 70% Stamina or Stability (owner, 2026-10-02)', () => {
  it('the ramp: 0 at/above 70%, linear to 1 at 0, no jump', () => {
    expect(AXIS_UNREST_START_FRACTION).toBe(0.7);
    expect(axisUnrest(1)).toBe(0);
    expect(axisUnrest(0.7)).toBe(0);
    expect(axisUnrest(0.35)).toBeCloseTo(0.5, 12);
    expect(axisUnrest(0)).toBe(1);
    for (let f = 0; f <= 1; f += 0.001) expect(Math.abs(axisUnrest(f + 0.001) - axisUnrest(f))).toBeLessThanOrEqual(0.001 / 0.7 + 1e-12);
  });

  /**
   * 10 s of real play driving straight forward and back along z (accelerate, release, reverse), the condition held at
   * `fraction` of Stamina (and Stability at 100%, or the other way round). Returns the largest axis angle off the
   * drive's own plane — the lean's sideways (x) part, which only precession creates here — and the largest wobble.
   */
  async function axisOverTenSeconds(stamina: number, stability: number) {
    const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 }, { x: 30, y: BEY_SPAWN_HEIGHT_M, z: 30 }, { arenaFloor: 'flat' });
    for (let i = 0; i < 30; i++) h.tick(NONE, NONE);
    let precessionDeg = 0;
    let wobbleDeg = 0;
    for (let t = 0; t < 600; t++) {
      h.first.stamina.resource.set(stamina * h.first.stamina.resource.max);
      h.first.stability.resource.set(stability * h.first.stability.resource.max);
      const phase = Math.floor(t / 60) % 4; // forward, coast, back, coast
      const held = phase === 0 ? [Action.MoveForward] : phase === 2 ? [Action.MoveBackward] : [];
      const r = h.tick({ ...NONE, held: new Set(held) }, NONE);
      precessionDeg = Math.max(precessionDeg, Math.abs(r.first.spin.lean.x) * DEG);
      wobbleDeg = Math.max(wobbleDeg, Math.abs(r.first.spin.wobbleOffsetRad) * DEG);
    }
    const v = h.first.body.translation();
    h.dispose();
    return { precessionDeg, wobbleDeg, x: v.x };
  }

  it('at 100% Stamina and Stability: no precession and no wobble over 10 s; at 30%: both present', async () => {
    const full = await axisOverTenSeconds(1, 1);
    expect(Math.abs(full.x)).toBeLessThan(0.05); // the drive stayed on its own plane
    expect(full.precessionDeg).toBeLessThan(0.01);
    expect(full.wobbleDeg).toBeLessThan(0.01);
    for (const [stamina, stability] of [[0.3, 1], [1, 0.3]] as const) {
      const tired = await axisOverTenSeconds(stamina, stability);
      expect(tired.precessionDeg, `stamina ${stamina}, stability ${stability}`).toBeGreaterThan(0.3);
      expect(tired.wobbleDeg, `stamina ${stamina}, stability ${stability}`).toBeGreaterThan(0.3);
    }
    // 75%: still above the threshold — steady.
    const above = await axisOverTenSeconds(0.75, 0.75);
    expect(above.precessionDeg).toBeLessThan(0.01);
    expect(above.wobbleDeg).toBeLessThan(0.01);
  }, 60_000);

  it('an impact still wobbles a healthy Bey for a moment, and it decays', () => {
    const spin = new SpinController();
    const body = { linvel: () => ({ x: 0, y: 0, z: 0 }), angvel: () => ({ x: 0, y: 0, z: 0 }) } as unknown as RAPIER.RigidBody;
    spin.registerImpact(body, 12, { x: 1, z: 0 });
    const start = spin.getSnapshot(body).wobbleEnergy;
    expect(start).toBeGreaterThan(0.3);
    for (let i = 0; i < 300; i++) spin.tick(body, 1 / 60, FULL_PHYSICAL_CONDITION, true, null, 1);
    expect(spin.getSnapshot(body).wobbleEnergy).toBeLessThan(start * 0.05);
  });
});

describe('no physics change (owner, 2026-10-02: confirm it)', () => {
  it('the attitude is not in the state hash', () => {
    expect(Object.keys(new SpinController().getDeterministicState())).toEqual(['spinRateRadPerSec']);
  });

  it('a 10 s exchange is bit-identical with the attitude wildly kicked every tick: nothing physical reads it', async () => {
    const run = async (kick: boolean) => {
      const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -2 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 2 }, { arenaFloor: 'bowl-a' });
      const trace: number[] = [];
      for (let t = 0; t < 600; t++) {
        const phase = Math.floor(t / 45) % 4;
        const first: ControllerActions = { ...NONE, held: new Set(phase === 3 ? [Action.SteerLeft, Action.MoveForward] : [Action.MoveForward]), pressedThisFrame: new Set(t % 90 === 30 ? [Action.Attack] : []) };
        const second: ControllerActions = { ...NONE, held: new Set(phase === 1 ? [Action.SteerRight] : [Action.MoveForward]) };
        if (kick) {
          for (const bey of [h.first, h.second]) bey.spin.registerImpact(bey.body, 30, { x: Math.sin(t), z: Math.cos(t) });
        }
        h.tick(first, second);
        for (const bey of [h.first, h.second]) {
          const p = bey.body.translation();
          const v = bey.body.linvel();
          trace.push(p.x, p.y, p.z, v.x, v.y, v.z, bey.stamina.resource.value, bey.stability.resource.value);
        }
      }
      h.dispose();
      return trace;
    };
    const calm = await run(false);
    const kicked = await run(true);
    expect(kicked).toEqual(calm);
  }, 60_000);
});

describe('H2 — a healthy Bey does not tumble (owner audit, 2026-10-03)', () => {
  /** A hard impact at the given condition; returns whether it tumbled, its peak tilt and its tilt 1.5 s later. */
  function hit(conditionFraction: number, impactMps = 30) {
    const spin = new SpinController(MOTION_DIRECTIONS.B.params);
    const body = { linvel: () => ({ x: 0, y: 0, z: 0 }), angvel: () => ({ x: 0, y: 0, z: 0 }) } as unknown as RAPIER.RigidBody;
    spin.tick(body, 1 / 60, FULL_PHYSICAL_CONDITION, true, null, conditionFraction);
    spin.registerImpact(body, impactMps, { x: 1, z: 0 });
    let tumbled = spin.getSnapshot(body).isTumbling;
    let peakDeg = 0;
    for (let i = 0; i < 90; i++) {
      spin.tick(body, 1 / 60, FULL_PHYSICAL_CONDITION, true, null, conditionFraction);
      const s = spin.getSnapshot(body);
      tumbled ||= s.isTumbling;
      peakDeg = Math.max(peakDeg, s.tiltRad * DEG);
    }
    return { tumbled, peakDeg, endDeg: spin.getSnapshot(body).tiltRad * DEG };
  }

  it('Stamina/Stability combinations: no tumble at/above 70%, tumble below, stronger as it empties', () => {
    const maxTilt = MOTION_DIRECTIONS.B.params.maxTilt;
    for (const c of [1, 0.85, 0.7]) {
      const r = hit(c);
      expect(r.tumbled, `condition ${c}`).toBe(false);
      expect(r.peakDeg, `condition ${c}`).toBeLessThan(maxTilt + 5); // the transient kick only, held by the stop at maxTilt
      expect(r.endDeg, `condition ${c}`).toBeLessThan(2); // back upright: nothing sustained
    }
    const half = hit(0.35);
    const empty = hit(0.05);
    expect(half.tumbled).toBe(true);
    expect(empty.tumbled).toBe(true);
    expect(empty.peakDeg).toBeGreaterThan(half.peakDeg);
    expect(empty.peakDeg).toBeGreaterThan(hit(1).peakDeg);
  });

  it('in a real match: the lower of Stamina and Stability drives it (Stability 30% with full Stamina tumbles too)', async () => {
    const tumbles = async (stamina: number, stability: number) => {
      const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 }, { x: 30, y: BEY_SPAWN_HEIGHT_M, z: 30 }, { arenaFloor: 'flat' });
      for (let i = 0; i < 30; i++) h.tick(NONE, NONE);
      let tumbled = false;
      for (let t = 0; t < 60; t++) {
        h.first.stamina.resource.set(stamina * h.first.stamina.resource.max);
        h.first.stability.resource.set(stability * h.first.stability.resource.max);
        if (t === 5) h.first.spin.registerImpact(h.first.body, 30, { x: 1, z: 0 });
        if (h.tick(NONE, NONE).first.spin.isTumbling) tumbled = true;
      }
      h.dispose();
      return tumbled;
    };
    expect(await tumbles(1, 1)).toBe(false);
    expect(await tumbles(0.8, 0.75)).toBe(false);
    expect(await tumbles(1, 0.3)).toBe(true);
    expect(await tumbles(0.3, 1)).toBe(true);
  });
});
