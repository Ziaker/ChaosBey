import { describe, expect, it } from 'vitest';
import { Action } from '../../src/input/actions/Action';
import { LATERAL_GRIP_PER_S } from '../../src/bey/movement/MovementTuning';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { DriftController, DriftState } from '../../src/drift/DriftController';
import { JUMP_RELEASE_WINDOW_S, JUMP_HOLD_FOR_FULL_DEFAULT_S } from '../../src/drift/DriftTuning';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { TestBeyHarness } from './physicsHarness';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import type { ControllerActions } from '../../src/input/actions/Action';

const intentArgs = (x: number, z: number) => ({ x, z });
/**
 * Directional control as DirectionalController sends it (owner, 2026-10-02): the world intent plus the screen's lateral
 * key kept in `held` (here the screen's up is +Z, so a direction toward ±X is a right/left key).
 */
function intent(x: number, z: number, held: Action[] = [], pressed: Action[] = []): ControllerActions {
  const lateral = x > 0.3 ? [Action.SteerRight] : x < -0.3 ? [Action.SteerLeft] : [];
  return { held: new Set([...held, ...lateral]), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0, moveIntent: { x, z } };
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
    // Moving: the drift rule needs the Bey in motion when X is pressed (owner, 2026-10-02).
    let vel = { x: 0, y: 0, z: 5 };
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

describe('jump vs drift: X + straight = variable jump, X + a real turn = drift (owner playtest, after M11)', () => {
  // A turn is measured against the direction latched when X was pressed, not the current
  // heading (which in directional control lines up with the held direction within a few ticks).
  interface Run {
    transitions: DriftState[];
    apexM: number;
    driftTicks: number;
    driftAfterHeadingAligned: boolean;
    recoveringRightAfterRelease: boolean;
    idleAtEnd: boolean;
  }
  async function run(opts: { moving: boolean; holdTicks: number; turnAt: number | null; direction?: boolean }): Promise<Run> {
    const harness = await TestBeyHarness.create({ x: -8, y: BEY_SPAWN_HEIGHT_M, z: -8 });
    // 60, not a shorter settle: grounded detection can still read false for a
    // tick or two right after the initial drop settles, and the "at rest"
    // (opts.moving: false) runs have no later movement phase to cover for
    // that — a hop pressed on an exact tick that happens to read ungrounded
    // never starts, so the whole run measures a false 0 m apex.
    harness.tickMany(intent(0, 0), 60);
    if (opts.moving) harness.tickMany(intent(0, 1), 50); // ~7.8 m/s along +Z
    const startY = harness.beyBody.translation().y;
    const r: Run = { transitions: [], apexM: 0, driftTicks: 0, driftAfterHeadingAligned: false, recoveringRightAfterRelease: false, idleAtEnd: false };
    let previous = DriftState.Idle;
    let headingAligned = false;
    for (let t = 0; t < opts.holdTicks + 45; t++) {
      const held = t < opts.holdTicks ? [Action.JumpDrift] : [];
      const turned = opts.turnAt !== null && t >= opts.turnAt;
      const dir = turned ? { x: 1, z: 0 } : opts.moving || opts.direction ? { x: 0, z: 1 } : { x: 0, z: 0 };
      const res = harness.tick(intent(dir.x, dir.z, held, t === 0 ? [Action.JumpDrift] : []));
      if (res.driftState !== previous) r.transitions.push(res.driftState);
      if (t === opts.holdTicks) r.recoveringRightAfterRelease = res.driftState === DriftState.Recovering;
      r.apexM = Math.max(r.apexM, harness.beyBody.translation().y - startY);
      if (res.driftState === DriftState.Drifting) {
        r.driftTicks++;
        const err = Math.atan2(Math.sin(harness.movement.getHeadingRad() - Math.PI / 2), Math.cos(harness.movement.getHeadingRad() - Math.PI / 2));
        if (Math.abs(err) < 0.05) headingAligned = true;
        else if (headingAligned) headingAligned = true;
        if (headingAligned) r.driftAfterHeadingAligned = true;
      }
      previous = res.driftState;
    }
    r.idleAtEnd = previous === DriftState.Idle;
    return r;
  }

  it('1. running straight + holding X = a tall jump, never a drift', async () => {
    const tap = await run({ moving: true, holdTicks: 1, turnAt: null });
    const hold = await run({ moving: true, holdTicks: 60, turnAt: null });
    expect(hold.transitions).not.toContain(DriftState.Drifting);
    expect(hold.apexM).toBeGreaterThan(tap.apexM * 1.4);
  });

  it('2. running + X + a turn = a small hop into Drifting', async () => {
    const tap = await run({ moving: true, holdTicks: 1, turnAt: null });
    // Turning right after the press: the hop stays small (going straight a few ticks first
    // still adds that much jump height — it was a jump until the turn).
    const drift = await run({ moving: true, holdTicks: 90, turnAt: 1 });
    expect(drift.transitions.slice(0, 2)).toEqual([DriftState.Hopping, DriftState.Drifting]);
    expect(drift.apexM).toBeLessThan(tap.apexM * 1.25);
  });

  it('3. the drift goes on after the heading has reached the held direction', async () => {
    const drift = await run({ moving: true, holdTicks: 90, turnAt: 5 });
    expect(drift.driftAfterHeadingAligned).toBe(true);
    expect(drift.driftTicks).toBeGreaterThan(30);
  });

  it('4. releasing X starts the grip recovery at once, then back to Idle', async () => {
    const drift = await run({ moving: true, holdTicks: 90, turnAt: 5 });
    expect(drift.recoveringRightAfterRelease).toBe(true);
    expect(drift.transitions.slice(-2)).toEqual([DriftState.Recovering, DriftState.Idle]);
    expect(drift.idleAtEnd).toBe(true);
  });

  it('4b. a drift armed within the first few ticks of the press produces the same small hop regardless of exactly when (jump/air-control hotfix section 21/22)', async () => {
    const turn1 = await run({ moving: true, holdTicks: 90, turnAt: 1 });
    const turn2 = await run({ moving: true, holdTicks: 90, turnAt: 2 });
    const turn3 = await run({ moving: true, holdTicks: 90, turnAt: 3 });
    for (const r of [turn1, turn2, turn3]) expect(r.transitions.slice(0, 2)).toEqual([DriftState.Hopping, DriftState.Drifting]);
    // DriftController.computeDriftHopCutMps targets a fixed APEX HEIGHT, not
    // a fixed velocity, specifically so a turn arming within this early
    // window still lands on (near enough) the same small hop regardless of
    // exactly which of these ticks it happens on.
    expect(turn2.apexM).toBeCloseTo(turn1.apexM, 1);
    expect(turn3.apexM).toBeCloseTo(turn1.apexM, 1);
  });

  it('4c. a drift armed late in the press is capped by physics, not by a second vertical event: taller than an early turn, but never taller than holding straight through to that same moment (jump/air-control hotfix section 2 finding — the height already gained before ANY cut can apply is structurally un-cuttable by a velocity-only correction; see the hold-duration sweep in the mandatory report for the measured curve)', async () => {
    const turnedEarly = await run({ moving: true, holdTicks: 90, turnAt: 1 });
    const turnedLate = await run({ moving: true, holdTicks: 90, turnAt: 10 });
    const heldStraightToSamePoint = await run({ moving: true, holdTicks: 10, turnAt: null });
    expect(turnedLate.transitions.slice(0, 2)).toEqual([DriftState.Hopping, DriftState.Drifting]);
    expect(turnedLate.apexM).toBeGreaterThan(turnedEarly.apexM);
    // Still strictly a reduction versus not cutting at all at that point:
    // this is the one-time cut doing the best it physically can, never a
    // "keeps rising" result that would mean a second vertical event.
    expect(turnedLate.apexM).toBeLessThan(heldStraightToSamePoint.apexM);
  });

  it('5. at rest + holding X = the variable jump (with or without a direction held), no drift', async () => {
    const tap = await run({ moving: false, holdTicks: 1, turnAt: null });
    const hold = await run({ moving: false, holdTicks: 60, turnAt: null });
    const holdPointing = await run({ moving: false, holdTicks: 60, turnAt: null, direction: true });
    for (const r of [hold, holdPointing]) {
      expect(r.transitions).not.toContain(DriftState.Drifting);
      expect(r.apexM).toBeGreaterThan(tap.apexM * 1.4);
    }
  });

  it('6. flat floor and bowls A/B/C (classic keys, the real scenario runner): straight + X jumps, X + turn drifts', async () => {
    const { runScenario } = await import('../../src/self-test/scenarios/ScenarioRunner');
    const { SCENARIO_PRESETS } = await import('../../src/self-test/scenarios/ScenarioPresets');
    const base = SCENARIO_PRESETS.find((p) => p.id === 'drift')!;
    const outcomes: Record<string, { jumpAssistS: number; jumpDrift: boolean; driftAssistS: number; driftTicks: number }> = {};
    for (const floor of ['flat', 'bowl-a', 'bowl-b', 'bowl-c'] as const) {
      let jump = { assist: 0, drift: false };
      let drift = { assist: 0, ticks: 0 };
      await runScenario(
        {
          ...base,
          first: { kind: 'script', frames: [{ fromTick: 0, held: [Action.MoveForward] }, { fromTick: 60, held: [Action.MoveForward, Action.JumpDrift] }, { fromTick: 150, held: [Action.MoveForward] }] },
          check: (t) => {
            jump = { assist: t.firstMaxJumpAssistS, drift: t.firstDriftStates.has('Drifting') };
            return { passed: true, detail: '' };
          },
        },
        { arenaFloor: floor },
      );
      await runScenario(
        {
          ...base,
          check: (t) => {
            drift = { assist: t.firstMaxJumpAssistS, ticks: t.firstDriftTicks };
            return { passed: true, detail: '' };
          },
        },
        { arenaFloor: floor },
      );
      outcomes[floor] = { jumpAssistS: jump.assist, jumpDrift: jump.drift, driftAssistS: drift.assist, driftTicks: drift.ticks };
    }
    for (const [floor, o] of Object.entries(outcomes)) {
      const label = `${floor}: ${JSON.stringify(o)}`;
      expect(o.jumpDrift, label).toBe(false);
      // The held jump waited the whole hold-for-full time before its one launch (owner, 2026-10-04: the height is
      // decided before take-off — the tracked hold time saturates there); the drift hop (turned 2 ticks after X)
      // almost none.
      expect(o.jumpAssistS, label).toBeGreaterThan(JUMP_HOLD_FOR_FULL_DEFAULT_S - 0.02);
      expect(o.driftAssistS, label).toBeLessThan(0.05);
      expect(o.driftTicks, label).toBeGreaterThanOrEqual(35);
    }
  }, 60_000);
});
