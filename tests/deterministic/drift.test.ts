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

  it('never enters Drifting when holding JumpDrift without any steering input', async () => {
    const harness = await TestBeyHarness.create();
    const settle = new ScriptedController([{ fromTick: 0, held: [] }]);
    // Let the Bey settle on the floor before tapping — tapping while still
    // falling from spawn height means the tap's grounded check misses
    // entirely, which isn't what this test is about.
    for (let i = 0; i < 30; i++) {
      harness.tick(settle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
    }

    // Regression: DriftController used to check only JumpDrift, so holding
    // it perfectly straight (no SteerLeft/SteerRight) incorrectly drifted.
    const controller = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward, Action.JumpDrift] }]);
    const statesSeen = new Set<DriftState>();
    for (let i = 0; i < 90; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      statesSeen.add(result.driftState);
    }

    expect(statesSeen.has(DriftState.Hopping)).toBe(true); // the hop itself doesn't need steering.
    expect(statesSeen.has(DriftState.Drifting)).toBe(false);
  });

  it('starts recovering as soon as steering is released, even while still holding JumpDrift', async () => {
    const harness = await TestBeyHarness.create();
    const enterDrift = new ScriptedController([
      { fromTick: 0, held: [Action.MoveForward] },
      { fromTick: 20, held: [Action.MoveForward, Action.JumpDrift, Action.SteerRight] },
    ]);

    // Run until Drifting is actually reached, whenever that naturally
    // happens (landing timing isn't perfectly fixed-tick), rather than
    // assuming it's still active at some hardcoded later tick.
    let reachedDrifting = false;
    for (let i = 0; i < 300 && !reachedDrifting; i++) {
      const result = harness.tick(enterDrift.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      if (result.driftState === DriftState.Drifting) reachedDrifting = true;
    }
    expect(reachedDrifting).toBe(true);

    // Now release steering (still holding JumpDrift) and confirm it
    // promptly leaves Drifting.
    const releaseSteering = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward, Action.JumpDrift] }]);
    let leftDrifting = false;
    for (let i = 0; i < 10; i++) {
      const result = harness.tick(releaseSteering.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      if (result.driftState !== DriftState.Drifting) {
        leftDrifting = true;
        break;
      }
    }
    expect(leftDrifting).toBe(true);
  });
});
