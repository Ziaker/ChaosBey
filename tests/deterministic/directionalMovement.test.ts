// M11 directional control, simulation side: the desired world direction
// (ControllerActions.moveIntent) steers the heading through the same turn
// rate / easing / grip as classic steering — no snap, no diagonal speed
// gain, reverse thrust while the direction is behind.

import { describe, expect, it } from 'vitest';
import { Action, type ControllerActions, type MoveIntent } from '../../src/input/actions/Action';
import { STEERING_MAX_TURN_RATE_RAD_S } from '../../src/bey/movement/MovementTuning';
import { DEFAULT_HANDLING_PROFILE } from '../../src/bey/archetype/BeyHandlingProfile';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { isSteering } from '../../src/bey/movement/directionalIntent';
import { TestBeyHarness } from './physicsHarness';

function intent(x: number, z: number, heldActions: Action[] = []): ControllerActions {
  return { held: new Set(heldActions), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0, moveIntent: { x, z } };
}

function classic(heldActions: Action[]): ControllerActions {
  return { held: new Set(heldActions), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
}

async function settled(): Promise<TestBeyHarness> {
  const harness = await TestBeyHarness.create();
  harness.tickMany(intent(0, 0), 30); // land and settle, heading 0 (+Z)
  return harness;
}

describe('directional movement (M11)', () => {
  it('turning toward a new direction takes physical time: no snap, turn rate never above the cap, settles without overshoot', async () => {
    const harness = await settled();
    const maxStep = DEFAULT_HANDLING_PROFILE.turnRateRadS * FIXED_DELTA_SECONDS + 1e-12;
    let previous = harness.movement.getHeadingRad();
    const first = harness.tick(intent(1, 0)); // want +X: yaw π/2
    expect(Math.abs(first.movement.headingRad - previous)).toBeLessThan(0.05); // eased, not snapped
    previous = first.movement.headingRad;
    let peak = previous;
    for (let i = 0; i < 180; i++) {
      const { movement } = harness.tick(intent(1, 0));
      expect(Math.abs(movement.headingRad - previous)).toBeLessThanOrEqual(maxStep);
      expect(Math.abs(harness.movement.getDebugState().turnRateRadPerS)).toBeLessThanOrEqual(STEERING_MAX_TURN_RATE_RAD_S + 1e-9);
      previous = movement.headingRad;
      peak = Math.max(peak, previous);
    }
    // A quarter turn at 2.6 rad/s can't finish in under ~0.6 s, and it settles on the direction.
    expect(previous).toBeCloseTo(Math.PI / 2, 2);
    expect(peak).toBeLessThan(Math.PI / 2 + 0.15);
  });

  it('a quarter turn is not instant: after 10 ticks the heading is still far from the target', async () => {
    const harness = await settled();
    harness.tickMany(intent(1, 0), 10);
    expect(harness.movement.getHeadingRad()).toBeLessThan(Math.PI / 4);
  });

  it('a direction behind the Bey starts with reverse thrust (moves that way at once) while the heading turns around', async () => {
    const harness = await settled();
    harness.tickMany(intent(0, 1), 40); // moving +Z
    const results = harness.tickMany(intent(0, -1), 20);
    // Velocity along +Z drops immediately (reverse thrust + drag), the heading has not flipped.
    expect(results[19]!.movement.actualVelocityVector.z).toBeLessThan(results[0]!.movement.actualVelocityVector.z);
    expect(Math.abs(harness.movement.getHeadingRad())).toBeLessThan(Math.PI * 0.75);
    const later = harness.tickMany(intent(0, -1), 120);
    expect(later.at(-1)!.movement.actualVelocityVector.z).toBeLessThan(-1);
  });

  it('a diagonal is not faster than a straight line', async () => {
    const speedAfter = async (dir: MoveIntent, headingRad: number): Promise<number> => {
      const harness = await settled();
      harness.movement.debugSetHeading(headingRad);
      return harness.tickMany(intent(dir.x, dir.z), 45).at(-1)!.movement.speedMps;
    };
    const straight = await speedAfter({ x: 0, z: 1 }, 0);
    const diagonal = await speedAfter({ x: Math.SQRT1_2 - 1e-4, z: Math.SQRT1_2 - 1e-4 }, Math.PI / 4);
    expect(straight).toBeGreaterThan(3);
    expect(diagonal).toBeLessThanOrEqual(straight * 1.02);
    expect(diagonal).toBeGreaterThan(straight * 0.95);
  });

  it('stick magnitude scales thrust: half tilt is slower than full tilt', async () => {
    const half = (await settled()).tickMany(intent(0, 0.5), 45).at(-1)!.movement.speedMps;
    const full = (await settled()).tickMany(intent(0, 1), 45).at(-1)!.movement.speedMps;
    expect(half).toBeLessThan(full * 0.75);
    expect(half).toBeGreaterThan(0.5);
  });

  it('a directional frame ignores Steer/Move actions, and a frame without moveIntent is classic', async () => {
    const a = await settled();
    const b = await settled();
    for (let i = 0; i < 30; i++) {
      a.tick(intent(0, 0, [Action.SteerRight, Action.MoveForward]));
      b.tick(intent(0, 0));
    }
    expect(a.beyBody.translation()).toEqual(b.beyBody.translation());
    const c = await settled();
    c.tickMany(classic([Action.SteerRight]), 30);
    expect(c.movement.getHeadingRad()).toBeGreaterThan(0.5); // classic still turns on a key
  });

  it('drift "steering" = a direction clearly off the heading', () => {
    expect(isSteering(intent(0, 1), 0)).toBe(false);
    expect(isSteering(intent(1, 0), 0)).toBe(true);
    expect(isSteering(intent(0, 0), 0)).toBe(false);
    expect(isSteering(classic([Action.SteerLeft]), 0)).toBe(true);
  });
});
