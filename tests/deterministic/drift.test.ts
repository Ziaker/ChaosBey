import { describe, expect, it } from 'vitest';
import { Action } from '../../src/input/actions/Action';
import { LATERAL_GRIP_PER_S } from '../../src/bey/movement/MovementTuning';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { DriftController, DriftState } from '../../src/drift/DriftController';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { TestBeyHarness } from './physicsHarness';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import type { ControllerActions } from '../../src/input/actions/Action';

const intentArgs = (x: number, z: number) => ({ x, z });
function intent(x: number, z: number, held: Action[] = [], pressed: Action[] = []): ControllerActions {
  return { held: new Set(held), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0, moveIntent: { x, z } };
}

describe('hop -> hold -> drift -> recover', () => {
  it('transitions Idle -> Hopping -> Drifting on tap+hold, reducing lateral grip, then Recovering -> Idle on release', async () => {
    const harness = await TestBeyHarness.create();

    // One continuous scripted run: drive straight, tap+hold JumpDrift+steer
    // at tick 45 (drift begins; the spawn drop's small Motion Lab floor
    // bounce has settled by then), release JumpDrift at tick 145 (only
    // MoveForward held from then on).
    const controller = new ScriptedController([
      { fromTick: 0, held: [Action.MoveForward] },
      { fromTick: 45, held: [Action.MoveForward, Action.JumpDrift, Action.SteerRight] },
      { fromTick: 145, held: [Action.MoveForward] },
    ]);

    const statesSeen: DriftState[] = [];
    let minLateralGripWhileDrifting = Infinity;
    for (let i = 0; i < 245; i++) {
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
    // Enough ticks elapsed after releasing JumpDrift (tick 145 -> 245,
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
    // 45 ticks: since the Motion Lab integration (M11) the drop from spawn
    // height lands with a small floor bounce (B: ×0.35) before settling.
    for (let i = 0; i < 45; i++) {
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

  it('lasts while JumpDrift is held: stopping the turn or the landing bounce does not end it; releasing X does', async () => {
    // Owner playtest (after M11): the drift used to end the moment the Bey
    // stopped "steering" or left the ground at all — the Motion Lab landing
    // bounce lifts it right after touchdown — so it measured 4 ticks.
    const harness = await TestBeyHarness.create();
    const enterDrift = new ScriptedController([
      { fromTick: 0, held: [Action.MoveForward] },
      { fromTick: 45, held: [Action.MoveForward, Action.JumpDrift, Action.SteerRight] },
    ]);
    let reachedDrifting = false;
    for (let i = 0; i < 300 && !reachedDrifting; i++) {
      if (harness.tick(enterDrift.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS })).driftState === DriftState.Drifting) reachedDrifting = true;
    }
    expect(reachedDrifting).toBe(true);

    // Stop turning, keep holding X: still drifting a second later.
    const holdStraight = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward, Action.JumpDrift] }]);
    for (let i = 0; i < 60; i++) {
      expect(harness.tick(holdStraight.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS })).driftState).toBe(DriftState.Drifting);
    }
    // Release X: recovering at once, then back to Idle with normal grip.
    const release = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);
    expect(harness.tick(release.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS })).driftState).toBe(DriftState.Recovering);
    let last = harness.tick(release.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
    for (let i = 0; i < 40; i++) last = harness.tick(release.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
    expect(last.driftState).toBe(DriftState.Idle);
  });

  it('directional control: tap X, hold it, turn — the full cycle, with the slide measured', async () => {
    // tap X → hop → X held → landing → Drifting → (X released) → Recovering → Idle.
    const harness = await TestBeyHarness.create({ x: -8, y: BEY_SPAWN_HEIGHT_M, z: -8 });
    harness.tickMany(intent(0, 0), 30);
    harness.tickMany(intent(0, 1), 50); // ~7.8 m/s along +Z
    const transitions: string[] = [];
    let previous: DriftState = DriftState.Idle;
    let speedBeforeLanding = 0;
    let speedAfterLanding = 0;
    let maxHeadingVsVelocityDeg = 0;
    let driftTicks = 0;
    let minGripWhileDrifting = Infinity;
    for (let t = 0; t < 150; t++) {
      const held = t < 110 ? [Action.JumpDrift] : [];
      const dir = t < 5 ? intentArgs(0, 1) : intentArgs(1, 0); // hop straight, then ask for +X
      const r = harness.tick(intent(dir.x, dir.z, held, t === 0 ? [Action.JumpDrift] : []));
      if (r.driftState !== previous) transitions.push(r.driftState);
      const v = harness.beyBody.linvel();
      if (previous === DriftState.Hopping && r.driftState !== DriftState.Hopping) speedAfterLanding = Math.hypot(v.x, v.z);
      if (r.driftState === DriftState.Hopping) speedBeforeLanding = Math.hypot(v.x, v.z);
      if (r.driftState === DriftState.Drifting) {
        driftTicks++;
        minGripWhileDrifting = Math.min(minGripWhileDrifting, r.movement.lateralGripPerS);
        const off = Math.atan2(v.x, v.z) - harness.movement.getHeadingRad();
        maxHeadingVsVelocityDeg = Math.max(maxHeadingVsVelocityDeg, Math.abs((Math.atan2(Math.sin(off), Math.cos(off)) * 180) / Math.PI));
      }
      previous = r.driftState;
    }
    expect(transitions).toEqual([DriftState.Hopping, DriftState.Drifting, DriftState.Recovering, DriftState.Idle]);
    // Drifting until X was released (tick 110), about a second after landing.
    expect(driftTicks).toBeGreaterThan(45);
    // It kept the hop's momentum through the landing (it used to lose ~35% in one step)…
    expect(speedAfterLanding).toBeGreaterThan(speedBeforeLanding * 0.95);
    // …with lowered lateral grip, and heading and velocity clearly apart: a slide, not a carve.
    expect(minGripWhileDrifting).toBeLessThan(LATERAL_GRIP_PER_S * 0.3);
    expect(maxHeadingVsVelocityDeg).toBeGreaterThan(45);
  });
});

describe('drift grip recovery targets the Bey\'s own archetype grip', () => {
  // Minimal stand-in for the two RAPIER.RigidBody methods DriftController
  // touches (the hop impulse) — grip recovery itself never reads the body.
  function stubBody() {
    let vel = { x: 0, y: 0, z: 0 };
    return {
      linvel: () => vel,
      setLinvel: (v: { x: number; y: number; z: number }) => {
        vel = v;
      },
    } as unknown as Parameters<DriftController['tick']>[0];
  }
  const actions = (held: Action[], pressed: Action[] = []) => ({
    held: new Set(held),
    pressedThisFrame: new Set(pressed),
    attackHoldDurationSeconds: 0,
    jumpDriftHoldDurationSeconds: 0,
  });

  // Regression: Recovering used to ease toward the global LATERAL_GRIP_PER_S
  // even after Milestone 6 made grip per-archetype, so a Defense-type
  // (higher grip) or Attack-type (lower grip) Bey ended recovery at the
  // wrong value and then snapped to its real grip on the next tick.
  it.each([
    ['higher-grip archetype', LATERAL_GRIP_PER_S * 1.25],
    ['lower-grip archetype', LATERAL_GRIP_PER_S * 0.9],
  ])('%s: the last Recovering tick is closer to that Bey\'s own grip than to the global default', (_label, archetypeGrip) => {
    const drift = new DriftController(archetypeGrip);
    const body = stubBody();
    const DT = FIXED_DELTA_SECONDS;
    const driftHeld = [Action.JumpDrift, Action.SteerRight];

    drift.tick(body, actions(driftHeld, [Action.JumpDrift]), true, DT); // hop
    for (let i = 0; i < 20; i++) drift.tick(body, actions(driftHeld), false, DT); // airborne
    expect(drift.tick(body, actions(driftHeld), true, DT).driftState).toBe(DriftState.Drifting); // land into drift

    let lastRecoveringGrip: number | null = null;
    for (let i = 0; i < 120; i++) {
      const result = drift.tick(body, actions([]), true, DT);
      if (result.driftState === DriftState.Recovering) lastRecoveringGrip = result.lateralGripOverridePerS;
    }

    expect(lastRecoveringGrip).not.toBeNull();
    expect(drift.getState()).toBe(DriftState.Idle);
    expect(Math.abs(lastRecoveringGrip! - archetypeGrip)).toBeLessThan(Math.abs(lastRecoveringGrip! - LATERAL_GRIP_PER_S));
  });
});
