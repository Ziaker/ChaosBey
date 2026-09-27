// ============================================================
// BEY MOTION LAB — PROTOTYPE MOTION MODEL (unit tests)
// The lab's model is a prototype, not game physics, but the owner compares
// presets shot for shot, so it must be deterministic, numerically stable
// in every scenario under every preset, and the presets must actually
// differ in the direction their names promise.
// ============================================================

import { describe, expect, it } from 'vitest';
import { MotionWorld, tiltAngle, type BeyBody } from '../../prototypes/bey-motion-concepts/src/physics/model';
import { PARAM_SPECS, PRESETS, presetParams, type PhysicsParams, type PresetId } from '../../prototypes/bey-motion-concepts/src/physics/params';
import { SCENARIOS, type Scenario } from '../../prototypes/bey-motion-concepts/src/physics/scenarios';

interface Trace {
  maxTilt: number;
  maxWhirl: number;
  maxSlipAngle: number;
  /** Seconds with the tip broken loose (lateral grip lost). */
  slipTime: number;
  maxHeight: number;
  maxSpeed: number;
  ringOut: boolean;
  final: BeyBody[];
}

function run(s: Scenario, params: PhysicsParams, bey = s.beys.length - 1): Trace {
  const w = new MotionWorld(params);
  w.reset(s.beys, s.hits ?? []);
  const trace: Trace = { maxTilt: 0, maxWhirl: 0, maxSlipAngle: 0, slipTime: 0, maxHeight: 0, maxSpeed: 0, ringOut: false, final: [] };
  for (let t = 0; t < s.duration; t += 1 / 60) {
    w.advance(1 / 60, (time, b) => s.input(time, b));
    for (const b of w.bodies) {
      for (const n of [b.pos.x, b.pos.z, b.vel.x, b.vel.z, b.y, b.vy, b.tilt.x, b.tilt.z, b.tiltRate.x, b.tiltRate.z, b.whirl, b.spinRate, b.wobbleEnergy, b.grip]) {
        expect(Number.isFinite(n), `${s.id}: finite state`).toBe(true);
      }
      expect(Math.hypot(b.vel.x, b.vel.z)).toBeLessThanOrEqual(params.maxLinearSpeed + 1e-6);
      expect(Math.abs(b.whirl)).toBeLessThanOrEqual(params.maxAngularSpeed + 1e-6);
      expect(tiltAngle(b)).toBeLessThanOrEqual((80 * Math.PI) / 180 + 1e-6);
    }
    const b = w.bodies[bey]!;
    trace.maxTilt = Math.max(trace.maxTilt, tiltAngle(b));
    trace.maxWhirl = Math.max(trace.maxWhirl, Math.abs(b.whirl));
    trace.maxHeight = Math.max(trace.maxHeight, b.y);
    const speed = Math.hypot(b.vel.x, b.vel.z);
    trace.maxSpeed = Math.max(trace.maxSpeed, speed);
    if (speed > 2) {
      let d = Math.atan2(b.vel.x, b.vel.z) - b.heading;
      d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
      trace.maxSlipAngle = Math.max(trace.maxSlipAngle, d);
    }
    if (b.slipping) trace.slipTime += 1 / 60;
    trace.ringOut ||= b.ringOut;
  }
  trace.final = w.bodies;
  return trace;
}

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const p = (id: PresetId) => presetParams(id);

describe('Bey Motion Lab — prototype motion model', () => {
  it('every scenario is stable (finite, clamped) under every preset and at every slider extreme', () => {
    for (const s of SCENARIOS) for (const preset of PRESETS) run(s, preset.params);
    // Each slider pushed to its minimum and maximum, one at a time, on the most violent scenarios.
    for (const spec of PARAM_SPECS) {
      for (const value of [spec.min, spec.max]) {
        const params = { ...p('C'), [spec.key]: value };
        for (const id of ['knock-strong', 'tumble', 'ricochet', 'm7-ext0-analog']) run(scenario(id), params);
      }
    }
  }, 180_000);

  it('is deterministic: the same scenario and parameters replay identically', () => {
    for (const id of ['drift', 'tumble', 'm7-ext32-analog']) {
      const a = run(scenario(id), p('B')).final;
      const b = run(scenario(id), p('B')).final;
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('presets differ in the promised direction: A steadier than B, B steadier than C', () => {
    const wallTilt = (id: PresetId) => run(scenario('wall'), p(id), 0).maxTilt;
    expect(wallTilt('A')).toBeLessThan(wallTilt('B'));
    expect(wallTilt('B')).toBeLessThan(wallTilt('C'));
    const whirl = (id: PresetId) => run(scenario('tumble'), p(id)).maxWhirl;
    expect(whirl('A')).toBeLessThan(whirl('B'));
    expect(whirl('B')).toBeLessThan(whirl('C'));
    const slip = (id: PresetId) => run(scenario('drift'), p(id), 0).slipTime;
    expect(slip('A')).toBeLessThan(slip('B'));
    expect(slip('B')).toBeLessThan(slip('C'));
    const bounce = (id: PresetId) => run(scenario('knock-strong'), p(id)).maxHeight;
    expect(bounce('A')).toBeLessThan(bounce('C'));
  });

  it('heading and velocity can differ (slip), and grip brings them back together', () => {
    const t = run(scenario('drift'), p('B'), 0);
    expect(t.maxSlipAngle).toBeGreaterThan(0.15);
    const b = t.final[0]!;
    let d = Math.atan2(b.vel.x, b.vel.z) - b.heading;
    d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    expect(d, 'grip recovered by the end').toBeLessThan(0.1);
    expect(t.ringOut).toBe(false);
  });

  it('recovers to upright after an impact (gradual recovery)', () => {
    const t = run(scenario('wobble'), p('B'));
    expect(t.maxTilt).toBeGreaterThan(0.05);
    const b = t.final[1]!;
    expect(tiltAngle(b)).toBeLessThan(0.02);
    expect(b.wobbleEnergy).toBeLessThan(0.1);
  });

  it('a wall hit bounces the Bey back inside the arena; a big launch near the edge can leave it', () => {
    const wall = run(scenario('wall'), p('B'), 0);
    expect(wall.ringOut).toBe(false);
    expect(Math.hypot(wall.final[0]!.pos.x, wall.final[0]!.pos.z)).toBeLessThan(12);
    // The M7 ext-0 analog: whether it rings out depends on the preset (C launches higher).
    expect(run(scenario('m7-ext0-analog'), p('C'), 0).ringOut).toBe(true);
    expect(run(scenario('m7-ext0-analog'), p('A'), 0).ringOut).toBe(false);
  });
});
