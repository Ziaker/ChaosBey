import { describe, expect, it } from 'vitest';
import { Action } from '../../src/input/actions/Action';
import { INTENDED_MAX_SPEED_MPS } from '../../src/bey/movement/MovementTuning';
import { MAX_GAMEPLAY_TILT_RAD } from '../../src/bey/spin/SpinTuning';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { TestBeyHarness } from './physicsHarness';

// GDD section 150 "First physics self-test suite" — these are the
// Milestone 1 foundation scenarios it calls for, run against the real
// controllers via a headless PhysicsWorld (no rendering involved).

describe('straight acceleration', () => {
  it('produces sensible, finite speed increase and no uncontrolled tilt', async () => {
    const harness = await TestBeyHarness.create();
    const controller = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);

    let finalSpeed = 0;
    let finalTilt = 0;
    for (let i = 0; i < 120; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      expect(Number.isFinite(result.movement.speedMps)).toBe(true);
      expect(Number.isFinite(result.spin.tiltRad)).toBe(true);
      finalSpeed = result.movement.speedMps;
      finalTilt = result.spin.tiltRad;
    }

    expect(finalSpeed).toBeGreaterThan(3);
    expect(finalSpeed).toBeLessThan(INTENDED_MAX_SPEED_MPS * 1.5);
    // Plain forward driving on flat ground must not itself throw the Bey
    // off-axis — tilt should stay well inside the gameplay reference range.
    expect(finalTilt).toBeLessThan(MAX_GAMEPLAY_TILT_RAD);
  });

  it('stays numerically stable under sustained overspeed pressure', async () => {
    const harness = await TestBeyHarness.create();
    const controller = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);

    for (let i = 0; i < 600; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      expect(Number.isFinite(result.movement.speedMps)).toBe(true);
      // Overspeed drag is a soft cap, not a hard clamp — but it must
      // converge, not run away.
      expect(result.movement.speedMps).toBeLessThan(INTENDED_MAX_SPEED_MPS * 2);
    }
  });
});

describe('high-speed steering', () => {
  it('lags velocity behind heading while turning (visible slip), then realigns once steering stops', async () => {
    const harness = await TestBeyHarness.create();
    // Short enough that the whole scenario (build speed + turn + coast)
    // stays well inside the arena — this test isolates grip/slip
    // behavior, not wall bounces.
    const straight = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);
    for (let i = 0; i < 40; i++) {
      harness.tick(straight.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
    }

    const turning = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward, Action.SteerRight] }]);
    let maxSlipDuringTurn = 0;
    for (let i = 0; i < 20; i++) {
      const result = harness.tick(turning.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      maxSlipDuringTurn = Math.max(maxSlipDuringTurn, Math.abs(result.movement.slipAngleRad));
    }
    // Heading changes immediately with steering input, but grip only
    // gradually pulls velocity toward it — this is the "direction change
    // takes physical time" requirement (GDD section 15), observed as a
    // non-trivial slip angle rather than an instant velocity snap.
    expect(maxSlipDuringTurn).toBeGreaterThan(0.05);

    // Coast (no throttle, no steering) rather than continuing to
    // accelerate: the arena is only ARENA_FLOOR_RADIUS=12m across, and
    // driving straight at speed for hundreds more ticks here would run
    // the Bey into the wall — a real, correct bounce, but not what this
    // test is isolating (pure grip realignment).
    const coast = new ScriptedController([{ fromTick: 0, held: [] }]);
    let lastSlip = maxSlipDuringTurn;
    for (let i = 0; i < 40; i++) {
      const result = harness.tick(coast.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      lastSlip = Math.abs(result.movement.slipAngleRad);
    }
    expect(lastSlip).toBeLessThan(maxSlipDuringTurn);
  });
});
