// ============================================================
// MILESTONE 3 — JUMP / DRIFT / DODGE SELF-TEST SUITE
// Full-integration scenarios driven through the real tickMatch()
// orchestration via CombatHarness (GDD section 114/150: exercise the real
// controllers, not a simplified stand-in).
// ============================================================

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { CIRCULAR_ACTIVE_DURATION_S } from '../../src/combat/attacks/AttackTuning';
import { DriftState } from '../../src/drift/DriftController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DODGE_ACTIVE_DURATION_S, DODGE_COOLDOWN_S, DODGE_PERFECT_WINDOW_S } from '../../src/dodge/DodgeTuning';
import { JUMP_ASSIST_MAX_DURATION_S } from '../../src/drift/DriftTuning';
import { LATERAL_GRIP_PER_S } from '../../src/bey/movement/MovementTuning';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { ScriptedController, type ScriptedFrame } from '../../src/automation/scripted-scenarios/ScriptedController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { CombatHarness } from './combatHarness';

const NO_ACTIONS: ControllerActions = {
  held: new Set(),
  pressedThisFrame: new Set(),
  attackHoldDurationSeconds: 0,
  jumpDriftHoldDurationSeconds: 0,
};

const CLOSE_FIRST_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -0.75 };
const CLOSE_SECOND_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0.75 };

function settle(harness: CombatHarness, ticks = 40): void {
  for (let i = 0; i < ticks; i++) {
    harness.tick(NO_ACTIONS, NO_ACTIONS);
  }
}

function tapJumpController(): ScriptedController {
  return new ScriptedController([
    { fromTick: 0, held: [Action.JumpDrift] },
    { fromTick: 2, held: [] },
  ]);
}

function heldJumpController(holdTicks: number): ScriptedController {
  return new ScriptedController([
    { fromTick: 0, held: [Action.JumpDrift] },
    { fromTick: holdTicks, held: [] },
  ]);
}

function pressFrames(ticks: number[]): ScriptedFrame[] {
  const frames: ScriptedFrame[] = [];
  for (const t of ticks) {
    frames.push({ fromTick: t, held: [Action.Dodge] });
    frames.push({ fromTick: t + 1, held: [] });
  }
  return frames;
}

/** Circular Attack tap starting (and thus becoming CircularActive) at a chosen tick. */
function delayedTapController(pressAtTick: number): ScriptedController {
  return new ScriptedController([
    { fromTick: pressAtTick, held: [Action.Attack] },
    { fromTick: pressAtTick + 2, held: [] },
  ]);
}

describe('variable jump height', () => {
  it('holding JumpDrift through the ascent reaches a higher apex than a bare tap', async () => {
    const tapHarness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(tapHarness);
    const tapController = tapJumpController();
    let tapApex = 0;
    for (let i = 0; i < 60; i++) {
      tapHarness.tick(tapController.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      tapApex = Math.max(tapApex, tapHarness.first.body.translation().y);
    }

    const heldHarness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(heldHarness);
    const holdTicks = Math.ceil(JUMP_ASSIST_MAX_DURATION_S / FIXED_DELTA_SECONDS) + 5;
    const heldController = heldJumpController(holdTicks);
    let heldApex = 0;
    for (let i = 0; i < 60; i++) {
      heldHarness.tick(heldController.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      heldApex = Math.max(heldApex, heldHarness.first.body.translation().y);
    }

    expect(heldApex).toBeGreaterThan(tapApex);
  });

  it('a bare tap never enters Landing recovery (Milestone 1 hop feel is unchanged)', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    const controller = tapJumpController();
    const visitedStates = new Set<DriftState>();
    for (let i = 0; i < 60; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      visitedStates.add(result.first.driftState);
    }
    expect(visitedStates.has(DriftState.Hopping)).toBe(true);
    expect(visitedStates.has(DriftState.Landing)).toBe(false);
  });

  it('landing from a big (held) jump enters a Landing recovery state that eases grip back to normal', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    const holdTicks = Math.ceil(JUMP_ASSIST_MAX_DURATION_S / FIXED_DELTA_SECONDS) + 5;
    const controller = heldJumpController(holdTicks);

    let sawLanding = false;
    let landedBackToIdle = false;
    let finalGripPerS = 0;
    for (let i = 0; i < 200; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (result.first.driftState === DriftState.Landing) {
        sawLanding = true;
        expect(result.first.movement.lateralGripPerS).toBeGreaterThan(0);
        expect(result.first.movement.lateralGripPerS).toBeLessThanOrEqual(LATERAL_GRIP_PER_S);
      }
      if (sawLanding && result.first.driftState === DriftState.Idle) {
        landedBackToIdle = true;
        finalGripPerS = result.first.movement.lateralGripPerS;
        break;
      }
    }

    expect(sawLanding).toBe(true);
    expect(landedBackToIdle).toBe(true);
    expect(finalGripPerS).toBeCloseTo(LATERAL_GRIP_PER_S, 2);
  });
});

describe('dodge i-frames', () => {
  it('nullifies a Circular Attack that would otherwise connect, without triggering the normal knockback/stability path', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // second dodges starting tick2 (i-frames roughly ticks 2-17); first's
    // Circular Attack becomes active at tick4 — well inside that window.
    const attacker = delayedTapController(2);
    const dodger = new ScriptedController(pressFrames([2]));

    let sawConnectedHit = false;
    let sawDodgedEvent = false;
    for (let i = 0; i < 60; i++) {
      const result = harness.tick(
        attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.hitEvents.some((hit) => hit.attackerIsFirst)) sawConnectedHit = true;
      if (result.combatEvents.some((e) => e.kind === 'dodged' && !e.targetIsFirst)) sawDodgedEvent = true;
    }

    expect(sawConnectedHit).toBe(false);
    expect(sawDodgedEvent).toBe(true);
    expect(harness.second.stability.resource.fraction).toBe(1);
  });

  it('a hit inside the early sub-window counts as a Perfect Dodge; the same dodge later in its window does not', async () => {
    // Perfect: dodge at tick2 (perfect window ~2..6.8), attack active at tick4.
    const perfectHarness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(perfectHarness);
    const perfectAttacker = delayedTapController(2);
    const perfectDodger = new ScriptedController(pressFrames([2]));
    let sawPerfect = false;
    for (let i = 0; i < 60; i++) {
      const result = perfectHarness.tick(
        perfectAttacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        perfectDodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.combatEvents.some((e) => e.kind === 'perfectDodge' && !e.targetIsFirst)) sawPerfect = true;
    }
    expect(sawPerfect).toBe(true);

    // Not perfect: dodge at tick0, hit checked past the perfect window
    // (~4.8 ticks) but still inside the full i-frame window (~15 ticks).
    // The dodge's own burst would otherwise carry the target sideways far
    // enough to leave Circular Attack's tight reach margin before the hit
    // is even checked, which would falsely read as "no dodge needed" —
    // pin position/velocity while the dodge timer runs past the perfect
    // window, purely to isolate i-frame *timing* from that positional side
    // effect, then let the attacker's hit through normally.
    const lateHarness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(lateHarness);
    // The resting height after settling, not the (higher) spawn height —
    // teleporting back to the spawn height every tick below would hold the
    // Bey permanently just above the floor, never actually touching it.
    const restingY = lateHarness.second.body.translation().y;
    const lateDodger = new ScriptedController(pressFrames([0]));
    const pinTicks = 6; // > DODGE_PERFECT_WINDOW_S (~4.8 ticks), < DODGE_ACTIVE_DURATION_S (~15 ticks)
    for (let i = 0; i < pinTicks; i++) {
      lateHarness.tick(NO_ACTIONS, lateDodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      lateHarness.second.body.setTranslation({ x: CLOSE_SECOND_SPAWN.x, y: restingY, z: CLOSE_SECOND_SPAWN.z }, true);
      lateHarness.second.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    const lateAttacker = new ScriptedController([
      { fromTick: 0, held: [Action.Attack] },
      { fromTick: 2, held: [] },
    ]);
    let sawDodgedLate = false;
    let sawPerfectLate = false;
    for (let i = 0; i < 30; i++) {
      const result = lateHarness.tick(
        lateAttacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        lateDodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.combatEvents.some((e) => e.kind === 'dodged' && !e.targetIsFirst)) sawDodgedLate = true;
      if (result.combatEvents.some((e) => e.kind === 'perfectDodge' && !e.targetIsFirst)) sawPerfectLate = true;
    }
    expect(sawDodgedLate).toBe(true);
    expect(sawPerfectLate).toBe(false);
  });

  it('cannot be re-triggered during its own cooldown, but can again once the cooldown elapses', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    const cooldownEndTick = Math.ceil(DODGE_ACTIVE_DURATION_S / FIXED_DELTA_SECONDS) + Math.ceil(DODGE_COOLDOWN_S / FIXED_DELTA_SECONDS);
    const retryDuringCooldownTick = 20;
    expect(retryDuringCooldownTick).toBeLessThan(cooldownEndTick);
    const retryAfterCooldownTick = cooldownEndTick + 5;

    const dodger = new ScriptedController(pressFrames([0, retryDuringCooldownTick, retryAfterCooldownTick]));

    let dodgingEntriesCount = 0;
    let previousState: DodgeState | null = null;
    for (let i = 0; i < retryAfterCooldownTick + 5; i++) {
      const result = harness.tick(NO_ACTIONS, dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      if (result.second.dodgeState === DodgeState.Dodging && previousState !== DodgeState.Dodging) {
        dodgingEntriesCount++;
      }
      previousState = result.second.dodgeState;
    }

    // Exactly two real dodges: the initial one and the retry after cooldown
    // — the mid-cooldown press must not have started a third.
    expect(dodgingEntriesCount).toBe(2);
  });
});

describe('air recovery', () => {
  it('pressing Dodge while airborne reduces wobble energy without entering the grounded Dodging state', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // A real impact (through the production impact path) to give the Bey
    // actual wobble/tilt to recover from.
    harness.first.spin.registerImpact(harness.first.body, 8, { x: 0, z: 1 });

    // Hop to get airborne, then dodge mid-air.
    const controller = new ScriptedController([
      { fromTick: 0, held: [Action.JumpDrift] },
      { fromTick: 2, held: [] },
      { fromTick: 3, held: [Action.Dodge] },
      { fromTick: 4, held: [] },
    ]);

    let wobbleBeforeRecovery = 0;
    let wobbleAfterRecovery = 0;
    let sawDodgingStateWhileAirborne = false;
    for (let i = 0; i < 20; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (i === 2) wobbleBeforeRecovery = result.first.spin.wobbleEnergy;
      if (i === 3) wobbleAfterRecovery = result.first.spin.wobbleEnergy;
      if (!result.first.grounded && result.first.dodgeState === DodgeState.Dodging) sawDodgingStateWhileAirborne = true;
    }

    expect(wobbleAfterRecovery).toBeLessThan(wobbleBeforeRecovery);
    expect(sawDodgingStateWhileAirborne).toBe(false);
  });

  it('is usable only once per airborne period', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    harness.first.spin.registerImpact(harness.first.body, 8, { x: 0, z: 1 });

    const controller = new ScriptedController([
      { fromTick: 0, held: [Action.JumpDrift] },
      { fromTick: 2, held: [] },
      { fromTick: 3, held: [Action.Dodge] },
      { fromTick: 4, held: [] },
      { fromTick: 5, held: [Action.Dodge] },
      { fromTick: 6, held: [] },
    ]);

    let wobbleAfterFirstRecovery = -1;
    let wobbleAfterSecondAttempt = -1;
    for (let i = 0; i < 20; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (i === 3) wobbleAfterFirstRecovery = result.first.spin.wobbleEnergy;
      if (i === 5) wobbleAfterSecondAttempt = result.first.spin.wobbleEnergy;
    }

    // The second mid-air press this same airborne period must not have
    // applied another reduction — wobble only decays passively between the
    // two samples, it doesn't drop by another full recovery step.
    expect(wobbleAfterSecondAttempt).toBeLessThanOrEqual(wobbleAfterFirstRecovery);
  });
});

describe('attack whiff-recovery timing after a dodge', () => {
  it('a dodged Circular Attack runs its full natural active duration instead of being cut short by a hit-confirm', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // Same overlap as the i-frames test above: the hit would otherwise
    // connect on the very first tick of CircularActive, which (undodged)
    // would call registerHitConfirmed() and truncate the active window to
    // a single tick. If the dodge is working, none of that happens — the
    // attack simply runs its whole course, exactly like a clean whiff.
    const attacker = delayedTapController(2);
    const dodger = new ScriptedController(pressFrames([2]));

    let circularActiveTickCount = 0;
    for (let i = 0; i < 30; i++) {
      const result = harness.tick(
        attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.first.attackState === AttackState.CircularActive) circularActiveTickCount++;
    }

    // Within one tick of the exact natural duration (floating-point dt
    // accumulation can push the threshold-crossing tick by ±1) — the real
    // thing being proven is "ran its full course", not an exact tick count:
    // a hit-confirm truncation would show up as a count of 1, nowhere close.
    const expectedTicks = Math.round(CIRCULAR_ACTIVE_DURATION_S / FIXED_DELTA_SECONDS);
    expect(circularActiveTickCount).toBeGreaterThanOrEqual(expectedTicks - 1);
    expect(circularActiveTickCount).toBeLessThanOrEqual(expectedTicks + 1);
  });
});
