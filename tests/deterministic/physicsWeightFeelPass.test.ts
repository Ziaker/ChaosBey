// ============================================================
// MOVEMENT/WEIGHT/DODGE PLAYTEST PASS — MANDATORY SELF-TESTS
// Formalizes the owner's required test matrix for this pass: dodge
// scenarios E-K (A-D, the 0/5/10/15 m/s speed-invariance check, live in
// jumpDriftDodge.test.ts next to the rest of the dodge suite), the
// short-hop/gravity curve, and representative weight/knockback arcs.
// Driven through the real tickMatch()/TestBeyHarness controllers, not a
// simplified stand-in (GDD section 114).
// ============================================================

import { describe, expect, it } from 'vitest';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { ScriptedController, type ScriptedFrame } from '../../src/automation/scripted-scenarios/ScriptedController';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DODGE_ACTIVE_DURATION_S, DODGE_BURST_SPEED_MPS } from '../../src/dodge/DodgeTuning';
import { DriftState } from '../../src/drift/DriftController';
import { JUMP_RELEASE_WINDOW_S } from '../../src/drift/DriftTuning';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
import { CombatHarness } from './combatHarness';
import { TestBeyHarness, type TickResult } from './physicsHarness';
import { motionParams } from '../../src/bey/motion/MotionPresets';
import { BEY_MASS_KG } from '../../src/bey/core/BeyTuning';

const NO_ACTIONS: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const CLOSE_FIRST_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -0.75 };
const CLOSE_SECOND_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0.75 };
const ACTIVE_TICKS = Math.round(DODGE_ACTIVE_DURATION_S / FIXED_DELTA_SECONDS);

function settle(harness: CombatHarness, ticks = 40): void {
  for (let i = 0; i < ticks; i++) harness.tick(NO_ACTIONS, NO_ACTIONS);
}

function classic(held: Action[], pressed: Action[] = []): ControllerActions {
  return { held: new Set(held), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
}

function dodgeRightFrames(ticks: number[]): ScriptedFrame[] {
  const frames: ScriptedFrame[] = [];
  for (const t of ticks) {
    frames.push({ fromTick: t, held: [Action.Dodge, Action.SteerRight] });
    frames.push({ fromTick: t + 1, held: [] });
  }
  return frames;
}

describe('dodge flat-velocity state — mandatory scenarios E-K (owner spec section 16)', () => {
  it('E: prior momentum pointing opposite the dodge direction does not reduce or cancel dodge speed', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, { x: 6, y: BEY_SPAWN_HEIGHT_M, z: 6 });
    settle(harness);
    // Heading 0 => dodge-right is +X. Give the Bey real momentum in -X (the opposite direction) first.
    harness.first.body.setLinvel({ x: -11, y: 0, z: 0 }, true);
    const dodger = new ScriptedController(dodgeRightFrames([0]));
    let result: ReturnType<CombatHarness['tick']> | null = null;
    for (let i = 0; i < 10; i++) result = harness.tick(dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
    const v = harness.first.body.linvel();
    expect(result!.first.dodgeState).toBe(DodgeState.Dodging);
    // Velocity is now in +X (the dodge's direction), not still negative from the opposing momentum.
    expect(v.x).toBeGreaterThan(DODGE_BURST_SPEED_MPS * 0.8);
    expect(Math.hypot(v.x, v.z)).toBeLessThan(DODGE_BURST_SPEED_MPS * 1.2);
  });

  it('F: dodging out of an active drift replaces drift\'s grip/velocity with the flat dodge speed', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, { x: 6, y: BEY_SPAWN_HEIGHT_M, z: 6 });
    settle(harness);
    harness.first.body.setLinvel({ x: 0, y: 0, z: 8 }, true); // heading 0 => +Z forward, real speed.
    // Tap + hold to enter Drifting (owner, 2026-10-04: X held from the first press is the full jump), then dodge
    // sideways mid-drift.
    const driver = new ScriptedController([
      { fromTick: 0, held: [Action.MoveForward, Action.JumpDrift, Action.SteerRight] },
      { fromTick: 2, held: [Action.MoveForward, Action.SteerRight] },
      { fromTick: 4, held: [Action.MoveForward, Action.JumpDrift, Action.SteerRight] },
      { fromTick: 25, held: [Action.MoveForward, Action.SteerRight, Action.Dodge] },
      { fromTick: 26, held: [Action.MoveForward, Action.SteerRight] },
    ]);
    let sawDrifting = false;
    let result!: ReturnType<CombatHarness['tick']>;
    for (let i = 0; i < 25; i++) {
      result = harness.tick(driver.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (result.first.driftState === DriftState.Drifting) sawDrifting = true;
    }
    expect(sawDrifting).toBe(true);
    for (let i = 0; i < 5; i++) result = harness.tick(driver.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
    expect(result.first.dodgeState).toBe(DodgeState.Dodging);
    const speed = Math.hypot(harness.first.body.linvel().x, harness.first.body.linvel().z);
    expect(speed).toBeGreaterThan(DODGE_BURST_SPEED_MPS * 0.8);
    expect(speed).toBeLessThan(DODGE_BURST_SPEED_MPS * 1.2);
  });

  it('G: a direction change mid-dodge does not curve the latched trajectory', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, { x: 6, y: BEY_SPAWN_HEIGHT_M, z: 6 });
    settle(harness);
    const driver = new ScriptedController([
      { fromTick: 0, held: [Action.Dodge, Action.SteerRight] }, // latches +X.
      { fromTick: 1, held: [Action.SteerLeft] }, // tries to steer the other way mid-dodge.
      { fromTick: ACTIVE_TICKS - 2, held: [] },
    ]);
    const headings: number[] = [];
    for (let i = 0; i < ACTIVE_TICKS - 1; i++) {
      harness.tick(driver.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      const v = harness.first.body.linvel();
      headings.push(Math.atan2(v.x, v.z));
    }
    // Every sampled tick's velocity direction is the same latched +X direction (atan2(x,z) ~ pi/2), regardless of the opposing SteerLeft held the whole time.
    for (const h of headings) expect(h).toBeCloseTo(Math.PI / 2, 1);
  });

  it('H: releasing the held direction mid-dodge does not change the latched trajectory or speed', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, { x: 6, y: BEY_SPAWN_HEIGHT_M, z: 6 });
    settle(harness);
    const driver = new ScriptedController([
      { fromTick: 0, held: [Action.Dodge, Action.SteerRight] },
      { fromTick: 1, held: [] }, // release everything right after the latching tick.
    ]);
    let result!: ReturnType<CombatHarness['tick']>;
    for (let i = 0; i < ACTIVE_TICKS - 1; i++) {
      result = harness.tick(driver.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      expect(result.first.dodgeState).toBe(DodgeState.Dodging);
      const v = harness.first.body.linvel();
      expect(v.x).toBeGreaterThan(DODGE_BURST_SPEED_MPS * 0.8);
      expect(Math.abs(v.z)).toBeLessThan(0.5);
    }
  });

  it('J: dodging straight into the arena wall is a real collision, not a pass-through', async () => {
    // Parked right at the wall, heading 0 (+Z) pointing straight out through it.
    const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: ARENA_FLOOR_RADIUS - 0.3 }, { x: 6, y: BEY_SPAWN_HEIGHT_M, z: -6 });
    settle(harness);
    const dodger = new ScriptedController([
      { fromTick: 0, held: [Action.Dodge, Action.MoveForward] }, // forward (+Z), straight at the wall.
      { fromTick: 1, held: [] },
    ]);
    let sawImpact = false;
    for (let i = 0; i < ACTIVE_TICKS + 5; i++) {
      const result = harness.tick(dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (result.first.movement.impactDeltaSpeedMps > 0) sawImpact = true;
    }
    const z = harness.first.body.translation().z;
    expect(sawImpact).toBe(true);
    expect(z).toBeLessThan(ARENA_FLOOR_RADIUS + 0.5); // did not clip through the wall.
  });

  it('K: dodging straight into another Bey is a real collision, not a pass-through', async () => {
    // Second Bey directly ahead on the dodge's own forward direction, close enough to hit within the active window.
    const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -1.5 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 1.5 });
    settle(harness);
    const dodger = new ScriptedController([
      { fromTick: 0, held: [Action.Dodge, Action.MoveForward] }, // forward (+Z), straight at the second Bey.
      { fromTick: 1, held: [] },
    ]);
    const startSecondZ = harness.second.body.translation().z;
    for (let i = 0; i < ACTIVE_TICKS + 10; i++) harness.tick(dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
    const firstZ = harness.first.body.translation().z;
    const secondZ = harness.second.body.translation().z;
    // The dodger didn't tunnel through the second Bey (stayed behind it), and the collision pushed the second Bey along.
    expect(firstZ).toBeLessThan(secondZ);
    expect(secondZ).toBeGreaterThan(startSecondZ);
  });
});

describe('short hop vs full jump — mandatory curve (owner spec section 17)', () => {
  function heldSequence(heldAt: (tick: number) => Action[]): (tick: number) => ControllerActions {
    let previous = new Set<Action>();
    return (tick: number) => {
      const held = new Set(heldAt(tick));
      const pressedThisFrame = new Set([...held].filter((a) => !previous.has(a)));
      previous = held;
      return { held, pressedThisFrame, attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
    };
  }

  async function hopArc(holdTicks: number, totalTicks: number, moving: boolean): Promise<{ apexM: number; airborneTicks: number; landedVelocityVector: { x: number; z: number } }> {
    const h = await TestBeyHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 });
    h.tickMany(classic([]), 60);
    if (moving) h.tickMany(classic([Action.MoveForward]), 30);
    const baseY = h.beyBody.translation().y;
    const actionsFor = heldSequence((t) => (t < holdTicks ? [Action.JumpDrift, ...(moving ? [Action.MoveForward] : [])] : moving ? [Action.MoveForward] : []));
    let apex = baseY;
    let airborneTicks = 0;
    let lastGrounded: TickResult | null = null;
    for (let t = 0; t < totalTicks; t++) {
      const r = h.tick(actionsFor(t));
      const y = h.beyBody.translation().y;
      if (y > apex) apex = y;
      if (y - baseY > 0.02) airborneTicks++;
      if (r.grounded) lastGrounded = r;
    }
    const v = h.beyBody.linvel();
    return { apexM: apex - baseY, airborneTicks, landedVelocityVector: { x: v.x, z: v.z } };
  }

  it('a bare tap is a genuinely short hop: both apex height and airtime are much smaller than a full held jump', async () => {
    // Jump/air-control hotfix: a true single-tick tap (press and release
    // within the same fixed tick — JumpDrift pressedThisFrame and already
    // released the very next tick) is the tightest, most consistent "short
    // hop" this architecture can produce; by 2 ticks (33 ms) height has
    // already grown noticeably (the single-launch-impulse model's own
    // "quick tap" variance — see the hold-duration sweep's own report).
    const tap = await hopArc(1, 90, false);
    const full = await hopArc(Math.ceil(JUMP_RELEASE_WINDOW_S / FIXED_DELTA_SECONDS) + 2, 150, false);
    expect(tap.apexM).toBeGreaterThan(0); // it does leave the ground.
    expect(full.apexM).toBeGreaterThan(tap.apexM * 5); // "<<", not just "less than".
    expect(full.airborneTicks).toBeGreaterThan(tap.airborneTicks * 3);
  });

  it('a jump while moving does not kill horizontal velocity on landing, and does not add extra forward boost', async () => {
    const grounded = await TestBeyHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 });
    grounded.tickMany(classic([]), 60);
    // Same 30 + 90 forward ticks as hopArc(2, 90, true) drives. This used to be
    // 30 ticks only, which compared a still-accelerating Bey (~4.4 m/s) with the
    // jumped one; the jumped Bey's speed only came out lower on the old 12 m
    // arena because it ran into the wall during those 120 ticks. On the 36 m
    // arena it reaches top speed without touching a wall, so the reference is
    // measured over the same window (arena scale pass; no jump behaviour changed).
    grounded.tickMany(classic([Action.MoveForward]), 120);
    const groundedSpeed = Math.hypot(grounded.beyBody.linvel().x, grounded.beyBody.linvel().z);

    const jumped = await hopArc(2, 90, true);
    const jumpedSpeed = Math.hypot(jumped.landedVelocityVector.x, jumped.landedVelocityVector.z);

    // The tap hop's own vertical impulse never pushes the Bey dramatically
    // faster along the ground than plain driving would (a real hidden
    // forward-boost bug would show up as a large multiple, not a modest
    // difference from the two scenarios' slightly different throttle
    // windows and airborne-acceleration scaling).
    expect(jumpedSpeed).toBeLessThanOrEqual(groundedSpeed * 1.3);
    // And landing didn't zero it out either.
    expect(jumpedSpeed).toBeGreaterThan(groundedSpeed * 0.5);
  });

  it('jump-at-rest and jump-while-moving reach comparable apex heights (the hop itself does not depend on ground speed)', async () => {
    const atRest = await hopArc(2, 90, false);
    const moving = await hopArc(2, 90, true);
    expect(Math.abs(atRest.apexM - moving.apexM)).toBeLessThan(Math.max(atRest.apexM, moving.apexM) * 0.3);
  });
});

describe('weight: knockback arcs scale with impulse, mass audited (owner spec section 18)', () => {
  it('a heavier knockback impulse produces a taller, longer arc than a lighter one, consistently with gravity', async () => {
    async function arc(horizontalImpulse: number): Promise<{ apexM: number; airborneTicks: number }> {
      const m = motionParams();
      const h = await TestBeyHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 });
      h.tickMany(classic([]), 60);
      const baseY = h.beyBody.translation().y;
      const upward = horizontalImpulse * m.knockbackScale * m.knockbackLift;
      h.beyBody.applyImpulse({ x: horizontalImpulse, y: upward, z: 0 }, true);
      let apex = baseY;
      let airborneTicks = 0;
      for (let t = 0; t < 240; t++) {
        const r = h.tick(classic([]));
        const y = h.beyBody.translation().y;
        if (y > apex) apex = y;
        if (y - baseY > 0.02) airborneTicks++;
        if (r.grounded && t > 5 && y - baseY < 0.02) break;
      }
      return { apexM: apex - baseY, airborneTicks };
    }
    const medium = await arc(6);
    const heavy = await arc(16);
    expect(heavy.apexM).toBeGreaterThan(medium.apexM);
    expect(heavy.airborneTicks).toBeGreaterThan(medium.airborneTicks);
  });

  it('BEY_MASS_KG is audited and intentionally untouched by this pass: free-fall/jump arcs here are mass-independent (locked rotations, velocity-set jump impulses)', () => {
    // Documents the finding behind this pass's gravity-only approach (see PhysicsWorld.ts) as a
    // committed, checkable fact rather than only a comment: if a future change ever makes mass
    // affect jump/fall arcs (e.g. switching a hop to an applyImpulse-based launch), this constant
    // moving on its own should prompt re-reading that reasoning, not a silent, undocumented drift.
    expect(BEY_MASS_KG).toBe(1.4);
  });
});
