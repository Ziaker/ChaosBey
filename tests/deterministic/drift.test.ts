import { describe, expect, it } from 'vitest';
import { Action } from '../../src/input/actions/Action';
import { LATERAL_GRIP_PER_S } from '../../src/bey/movement/MovementTuning';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { DriftState } from '../../src/drift/DriftController';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { TestBeyHarness } from './physicsHarness';

describe('hop -> hold -> drift -> recover', () => {
  it('transitions Idle -> Hopping -> Drifting on tap+hold, reducing lateral grip, then Recovering -> Idle on release', async () => {
    const harness = await TestBeyHarness.create();

    // One continuous scripted run: drive straight, tap+hold JumpDrift+steer
    // at tick 20 (drift begins), release JumpDrift at tick 120 (only
    // MoveForward held from then on).
    const controller = new ScriptedController([
      { fromTick: 0, held: [Action.MoveForward] },
      { fromTick: 20, held: [Action.MoveForward, Action.JumpDrift, Action.SteerRight] },
      { fromTick: 120, held: [Action.MoveForward] },
    ]);

    const statesSeen: DriftState[] = [];
    let minLateralGripWhileDrifting = Infinity;
    for (let i = 0; i < 220; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      statesSeen.push(result.driftState);
      if (result.driftState === DriftState.Drifting) {
        minLateralGripWhileDrifting = Math.min(minLateralGripWhileDrifting, result.movement.lateralGripPerS);
      }
    }

    const seen = new Set(statesSeen);
    expect(seen.has(DriftState.Hopping)).toBe(true);
    expect(seen.has(DriftState.Drifting)).toBe(true);
    expect(seen.has(DriftState.Recovering)).toBe(true);
    expect(minLateralGripWhileDrifting).toBeLessThan(LATERAL_GRIP_PER_S);
    // Enough ticks elapsed after releasing JumpDrift (tick 120 -> 220,
    // well over DRIFT_GRIP_RECOVERY_DURATION_S) that it should have
    // settled back to Idle by the end.
    expect(statesSeen[statesSeen.length - 1]).toBe(DriftState.Idle);
  });
});
