import { describe, expect, it } from 'vitest';
import { Action } from '../../src/input/actions/Action';
import { ARENA_FLOOR_RADIUS, ARENA_WALL_THICKNESS } from '../../src/arena/colliders/ArenaTuning';
import { WOBBLE_ENERGY_MAX } from '../../src/bey/spin/SpinTuning';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { TestBeyHarness } from './physicsHarness';

describe('wall collision', () => {
  it('bounces off the arena wall without tunneling through it, and produces an angular response', async () => {
    const harness = await TestBeyHarness.create();
    const controller = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);

    let sawImpact = false;
    let sawAngularResponseAfterImpact = false;
    let maxDistanceFromCenter = 0;
    let maxSpeedObserved = 0;

    for (let i = 0; i < 400; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));

      const t = harness.beyBody.translation();
      expect(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)).toBe(true);
      expect(Number.isFinite(result.movement.speedMps)).toBe(true);

      maxDistanceFromCenter = Math.max(maxDistanceFromCenter, Math.hypot(t.x, t.z));
      maxSpeedObserved = Math.max(maxSpeedObserved, result.movement.speedMps);

      if (result.movement.impactDeltaSpeedMps > 0) {
        sawImpact = true;
      }
      if (sawImpact) {
        const angularSpeedHorizontal = Math.hypot(result.spin.angularVelocity.x, result.spin.angularVelocity.z);
        if (angularSpeedHorizontal > 0.05) {
          sawAngularResponseAfterImpact = true;
        }
      }
    }

    expect(sawImpact).toBe(true);
    expect(sawAngularResponseAfterImpact).toBe(true);
    // No tunneling: the collider's center should never end up meaningfully
    // past the wall's outer face.
    expect(maxDistanceFromCenter).toBeLessThan(ARENA_FLOOR_RADIUS + ARENA_WALL_THICKNESS + 0.5);
    // No unbounded energy gain from repeated bounces (a restitution/solver
    // bug could otherwise let speed climb without limit).
    expect(maxSpeedObserved).toBeLessThan(30);
  });
});

describe('wobble and long-run stability', () => {
  it('keeps wobble energy bounded and all physics values finite across a long run with repeated wall bounces', async () => {
    const harness = await TestBeyHarness.create();
    const controller = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward, Action.SteerRight] }]);

    for (let i = 0; i < 1200; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));

      expect(Number.isFinite(result.movement.speedMps)).toBe(true);
      expect(Number.isFinite(result.spin.tiltRad)).toBe(true);
      expect(Number.isFinite(result.spin.wobbleEnergy)).toBe(true);
      expect(Number.isFinite(result.spin.spinRateRadPerSec)).toBe(true);
      expect(result.spin.wobbleEnergy).toBeGreaterThanOrEqual(0);
      expect(result.spin.wobbleEnergy).toBeLessThanOrEqual(WOBBLE_ENERGY_MAX + 1e-9);

      const t = harness.beyBody.translation();
      expect(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)).toBe(true);
    }
  });
});

describe('upright recovery', () => {
  it('recovers tilt back toward upright after a strong disturbance, when left alone', async () => {
    const harness = await TestBeyHarness.create();
    // Go through the real production impact path (the same one a strong
    // wall bounce would trigger) rather than a hand-picked torque, so this
    // test reflects what actual gameplay impacts produce.
    harness.spin.registerImpact(harness.beyBody, 8, { x: 0, z: 1 });

    const noInput = new ScriptedController([{ fromTick: 0, held: [] }]);
    let peakTilt = 0;
    let finalTilt = 0;
    for (let i = 0; i < 180; i++) {
      const result = harness.tick(noInput.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      expect(Number.isFinite(result.spin.tiltRad)).toBe(true);
      peakTilt = Math.max(peakTilt, result.spin.tiltRad);
      finalTilt = result.spin.tiltRad;
    }

    expect(peakTilt).toBeGreaterThan(0.05);
    expect(finalTilt).toBeLessThan(peakTilt);
    expect(finalTilt).toBeLessThan(0.1);
  });
});
