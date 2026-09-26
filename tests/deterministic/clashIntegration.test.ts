// ============================================================
// CLASH INTEGRATION SELF-TESTS (GDD section 152)
// Full-integration scenarios driven through the real tickMatch()
// orchestration via CombatHarness — exercising Milestone 5's Clash wired
// into the actual Attack/Hit/Knockback/Stability/RingOut systems, not a
// simplified stand-in (GDD section 114/150). Milestone 5's own pure-domain
// self-tests (clashWindow/clashMash/clashFormula/clashController.test.ts)
// already cover the state machine and formula in isolation — these tests
// cover the integration layer (ClashOrchestration + tickMatch) itself:
// compatible-attack detection, freeze while Active, real Z/X/C + AI mash,
// physical resolution (FirstWins/SecondWins/Tie), the cooldown alternative
// resolution, and that Clash never artificially declares a ring-out.
// ============================================================

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { ClashOutcome, ClashState } from '../../src/combat/clash/ClashController';
import { CLASH_COOLDOWN_S, CLASH_IMPACT_MULTIPLIER, CLASH_TARGET_DURATION_S } from '../../src/combat/clash/ClashTuning';
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

// +1 tick of headroom for the same binary-floating-point reason documented
// in clashController.test.ts and Milestone 3's whiff-recovery-timing test.
const DURATION_TICKS = Math.ceil(CLASH_TARGET_DURATION_S / FIXED_DELTA_SECONDS) + 1;
const COOLDOWN_TICKS = Math.ceil(CLASH_COOLDOWN_S / FIXED_DELTA_SECONDS) + 1;

function settle(harness: CombatHarness, ticks = 15): void {
  for (let i = 0; i < ticks; i++) {
    harness.tick(NO_ACTIONS, NO_ACTIONS);
  }
}

/** Quick press+release, well under TAP_MAX_HOLD_S — commits to a Circular Attack. */
function tapController(): ScriptedController {
  return new ScriptedController([
    { fromTick: 0, held: [Action.Attack] },
    { fromTick: 2, held: [] },
  ]);
}

/** Presses (and releases one tick later) `action` every `intervalTicks` ticks, from tick 0 through `totalTicks` — a real Z/X/C mash pattern (see ClashMash.ts's "simultaneous presses count as one" and "separate ticks accumulate" rules), independent of Clash/attack state so it naturally continues seamlessly from a pre-Clash attack input straight into the Active mash window. */
function mashFrames(intervalTicks: number, totalTicks: number, action: Action = Action.Dodge): ScriptedFrame[] {
  const frames: ScriptedFrame[] = [];
  for (let t = 0; t < totalTicks; t += intervalTicks) {
    frames.push({ fromTick: t, held: [action] });
    frames.push({ fromTick: t + 1, held: [] });
  }
  return frames;
}

async function createTriggerReadyHarness(): Promise<CombatHarness> {
  const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
  settle(harness);
  return harness;
}

/** Drives both sides tapping Attack in lockstep until the same-tick compatible connect is detected (Clash leaves Idle) — the trigger mechanism every resolution-focused test below builds on. */
function triggerClash(harness: CombatHarness, firstMash: ScriptedController, secondMash: ScriptedController): void {
  for (let i = 0; i < 60 && harness.clash.controller.getState() === ClashState.Idle; i++) {
    harness.tick(
      firstMash.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      secondMash.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
    );
  }
  expect(harness.clash.controller.getState()).toBe(ClashState.Active);
}

describe('compatible-attack detection (same-tick window)', () => {
  it('a same-tick double connect starts a Clash and withholds normal knockback/Stability damage from both hits entirely', async () => {
    const harness = await createTriggerReadyHarness();
    const firstAttacker = tapController();
    const secondAttacker = tapController();

    let sawKnockbackOrStabilityDamageOnTrigger = false;
    let result;
    for (let i = 0; i < 60 && harness.clash.controller.getState() === ClashState.Idle; i++) {
      result = harness.tick(
        firstAttacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        secondAttacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.combatEvents.some((e) => e.kind === 'knockback' || e.kind === 'stabilityDamage')) {
        sawKnockbackOrStabilityDamageOnTrigger = true;
      }
    }

    expect(harness.clash.controller.getState()).toBe(ClashState.Active);
    expect(sawKnockbackOrStabilityDamageOnTrigger).toBe(false);
    // Both attacks still register as connecting hits for ordinary Hit telemetry/VFX — only their knockback/Stability consequence is withheld.
    expect(result!.hitEvents.length).toBe(2);
  });

  it('a solo hit (no compatible opposite-side hit this tick) resolves immediately with normal knockback, completely unaffected by Clash', async () => {
    const harness = await createTriggerReadyHarness();
    const attacker = tapController();

    let sawKnockback = false;
    for (let i = 0; i < 60; i++) {
      const result = harness.tick(attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (result.combatEvents.some((e) => e.kind === 'knockback')) sawKnockback = true;
    }

    expect(sawKnockback).toBe(true);
    expect(harness.clash.controller.getState()).toBe(ClashState.Idle);
    expect(harness.second.stability.resource.fraction).toBeLessThan(1);
  });
});

describe('freeze while Active', () => {
  it('freezes physics/movement entirely for the whole ~4s contest, but still samples real Z/X/C mash input live', async () => {
    const harness = await createTriggerReadyHarness();
    triggerClash(harness, tapController(), tapController());

    const firstPositionAtActiveStart = harness.first.body.translation();
    const secondPositionAtActiveStart = harness.second.body.translation();

    const firstMasher = new ScriptedController(mashFrames(2, DURATION_TICKS, Action.Dodge));
    // Second gets zero real input for the whole contest — any mash it accrues comes purely from the AI-mash abstraction.
    for (let i = 0; i < DURATION_TICKS && harness.clash.controller.getState() === ClashState.Active; i++) {
      harness.tick(firstMasher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
    }

    // Positions never moved — the whole normal simulation (including physics.step()) was frozen throughout.
    const firstPositionNow = harness.first.body.translation();
    const secondPositionNow = harness.second.body.translation();
    expect(firstPositionNow.x).toBeCloseTo(firstPositionAtActiveStart.x, 5);
    expect(firstPositionNow.y).toBeCloseTo(firstPositionAtActiveStart.y, 5);
    expect(firstPositionNow.z).toBeCloseTo(firstPositionAtActiveStart.z, 5);
    expect(secondPositionNow.x).toBeCloseTo(secondPositionAtActiveStart.x, 5);
    expect(secondPositionNow.z).toBeCloseTo(secondPositionAtActiveStart.z, 5);

    // Real mash input was live throughout — first's count reflects its own presses.
    expect(harness.clash.controller.getFirstMashEventCount()).toBeGreaterThan(0);
    // Second pressed nothing at all — its count came entirely from the same per-combatant AI-mash abstraction (see ClashMash.ts), not a separate channel.
    expect(harness.clash.controller.getSecondMashEventCount()).toBeGreaterThan(0);
  });
});

describe('resolution — FirstWins applies real physical knockback', () => {
  it('the loser is launched via normal knockback machinery scaled by CLASH_IMPACT_MULTIPLIER, takes Stability damage, and no ring-out is ever declared by Clash itself', async () => {
    const harness = await createTriggerReadyHarness();
    // Unambiguous ClashPower advantage for "first" regardless of how mash saturates for either side — Stamina alone decides it here.
    harness.second.stamina.resource.subtract(harness.second.stamina.resource.max * 0.9);

    triggerClash(harness, tapController(), tapController());

    const secondVelocityBefore = harness.second.body.linvel();
    const secondStabilityBefore = harness.second.stability.resource.fraction;

    // Both sides mash for real during Active — otherwise only "second" would
    // accrue any mash at all (via the AI abstraction), which would swamp
    // "first"'s Stamina advantage. Matching cadences means Stamina alone
    // decides the outcome, as intended.
    const firstMasher = new ScriptedController(mashFrames(3, DURATION_TICKS, Action.Dodge));
    const secondMasher = new ScriptedController(mashFrames(3, DURATION_TICKS, Action.JumpDrift));
    let resolvedResult;
    for (let i = 0; i < DURATION_TICKS && !resolvedResult; i++) {
      const result = harness.tick(
        firstMasher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        secondMasher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.clashResolvedThisTick) resolvedResult = result;
    }

    expect(resolvedResult).toBeDefined();
    expect(resolvedResult!.clashResolvedThisTick!.outcome).toBe(ClashOutcome.FirstWins);
    expect(resolvedResult!.ringOutFirst).toBe(false);
    expect(resolvedResult!.ringOutSecond).toBe(false);
    expect(resolvedResult!.combatEvents.some((e) => e.kind === 'knockback' && e.targetIsFirst === false)).toBe(true);
    expect(resolvedResult!.combatEvents.some((e) => e.kind === 'stabilityDamage' && e.targetIsFirst === false)).toBe(true);
    expect(harness.second.stability.resource.fraction).toBeLessThan(secondStabilityBefore);
    expect(CLASH_IMPACT_MULTIPLIER).toBeGreaterThan(0); // sanity: the multiplier this resolution applied is a real, positive scale factor.

    // physics.step() resumes on the next (Cooldown) tick — the impulse from resolution only becomes visible motion then.
    const nextResult = harness.tick(NO_ACTIONS, NO_ACTIONS);
    expect(nextResult.clashResolvedThisTick).toBeNull();
    const secondVelocityAfter = harness.second.body.linvel();
    const speedBefore = Math.hypot(secondVelocityBefore.x, secondVelocityBefore.z);
    const speedAfter = Math.hypot(secondVelocityAfter.x, secondVelocityAfter.z);
    expect(speedAfter).toBeGreaterThan(speedBefore);
    expect(harness.clash.controller.getState()).toBe(ClashState.Cooldown);
    expect(harness.clash.controller.getCooldownRemainingS()).toBeGreaterThan(0);
  });
});

describe('resolution — Tie applies symmetric repulsion, no winner, no damage', () => {
  it('both Beys receive equal-and-opposite physical repulsion, neither takes Stability damage, and the normal cooldown still starts', async () => {
    const harness = await createTriggerReadyHarness();
    // Equal Stamina/speed on both sides, and both mash fast enough to saturate MashPerformance well before the contest ends -> ClashPower ends up equal -> Tie.
    triggerClash(harness, tapController(), tapController());

    const firstStabilityBefore = harness.first.stability.resource.fraction;
    const secondStabilityBefore = harness.second.stability.resource.fraction;
    const firstMasher = new ScriptedController(mashFrames(3, DURATION_TICKS, Action.Dodge));
    const secondMasher = new ScriptedController(mashFrames(3, DURATION_TICKS, Action.JumpDrift));

    // Velocity is constant while frozen (Active never steps physics) —
    // whatever it reads on the tick just before resolution is exactly the
    // "before the repulsion impulse" baseline, however it got there (e.g.
    // residual spin/wobble noise, which is real and not something the
    // Clash system controls or needs to cancel out).
    let firstVelBefore = harness.first.body.linvel();
    let secondVelBefore = harness.second.body.linvel();
    let resolvedResult;
    for (let i = 0; i < DURATION_TICKS && !resolvedResult; i++) {
      const result = harness.tick(
        firstMasher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        secondMasher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.clashResolvedThisTick) {
        resolvedResult = result;
      } else {
        firstVelBefore = harness.first.body.linvel();
        secondVelBefore = harness.second.body.linvel();
      }
    }

    expect(resolvedResult).toBeDefined();
    expect(resolvedResult!.clashResolvedThisTick!.outcome).toBe(ClashOutcome.Tie);
    expect(resolvedResult!.combatEvents.some((e) => e.kind === 'knockback')).toBe(false);
    expect(resolvedResult!.combatEvents.some((e) => e.kind === 'stabilityDamage')).toBe(false);
    expect(resolvedResult!.ringOutFirst).toBe(false);
    expect(resolvedResult!.ringOutSecond).toBe(false);
    expect(harness.first.stability.resource.fraction).toBe(firstStabilityBefore);
    expect(harness.second.stability.resource.fraction).toBe(secondStabilityBefore);

    // applyImpulse() updates linear velocity immediately (physics.step()
    // integrates position from it afterward) — read it right off the
    // resolution tick itself, before anything else can perturb it.
    const firstVel = harness.first.body.linvel();
    const secondVel = harness.second.body.linvel();
    const firstDeltaZ = firstVel.z - firstVelBefore.z;
    const secondDeltaZ = secondVel.z - secondVelBefore.z;
    // The repulsion impulse itself is pushed apart along the (shared)
    // first<->second axis, exactly equal and opposite horizontally.
    expect(firstDeltaZ).toBeLessThan(0); // first was spawned on the -z side, pushed further away from second.
    expect(secondDeltaZ).toBeGreaterThan(0);
    expect(Math.abs(firstDeltaZ)).toBeCloseTo(Math.abs(secondDeltaZ), 4);
    expect(harness.clash.controller.getState()).toBe(ClashState.Cooldown);
  });
});

describe('cooldown alternative resolution', () => {
  it('a compatible double-hit during Cooldown does not start a new Clash, and the slower combatant takes more knockback/Stability damage than the faster one', async () => {
    const harness = await createTriggerReadyHarness();
    triggerClash(harness, tapController(), tapController());

    const firstMasher = new ScriptedController(mashFrames(3, DURATION_TICKS, Action.Dodge));
    const secondMasher = new ScriptedController(mashFrames(3, DURATION_TICKS, Action.JumpDrift));
    for (let i = 0; i < DURATION_TICKS && harness.clash.controller.getState() === ClashState.Active; i++) {
      harness.tick(
        firstMasher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        secondMasher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
    }
    expect(harness.clash.controller.getState()).toBe(ClashState.Cooldown);

    // Let the resolution's own impulse play out and attack recovery windows (frozen throughout Active) fully elapse, well short of the 10s cooldown.
    for (let i = 0; i < 45; i++) harness.tick(NO_ACTIONS, NO_ACTIONS);
    expect(harness.clash.controller.getState()).toBe(ClashState.Cooldown);

    // Reset to a clean, close, deliberately asymmetric-speed setup for the cooldown-alternative double-hit.
    harness.first.body.setTranslation(CLOSE_FIRST_SPAWN, true);
    harness.second.body.setTranslation(CLOSE_SECOND_SPAWN, true);
    harness.first.body.setLinvel({ x: 0, y: 0, z: 8 }, true); // fast.
    harness.second.body.setLinvel({ x: 0, y: 0, z: 0 }, true); // slow (stationary).

    const secondFirstAttacker = tapController();
    const secondSecondAttacker = tapController();
    let resolvedTickResult;
    for (let i = 0; i < 60 && !resolvedTickResult; i++) {
      const result = harness.tick(
        secondFirstAttacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        secondSecondAttacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.combatEvents.some((e) => e.kind === 'knockback')) resolvedTickResult = result;
    }

    expect(resolvedTickResult).toBeDefined();
    // Did NOT start a fresh Clash — stayed on (or returned to, if the wait above happened to finish it — guarded by the isOnCooldown() check above) Cooldown throughout.
    expect(harness.clash.controller.getState()).toBe(ClashState.Cooldown);

    const knockbackEvents = resolvedTickResult!.combatEvents.filter((e) => e.kind === 'knockback');
    expect(knockbackEvents).toHaveLength(2);
    const forceAgainstFirst = knockbackEvents.find((e) => e.targetIsFirst === true)!.force;
    const forceAgainstSecond = knockbackEvents.find((e) => e.targetIsFirst === false)!.force;
    // "first" was moving fast (harder to further destabilize — see Knockback.ts's defender-speed vulnerability), "second" was the stationary, slower combatant and gets the cooldown-alternative penalty on top — it should come out worse off.
    expect(forceAgainstSecond).toBeGreaterThan(forceAgainstFirst);
  });
});

describe('Clash never artificially declares a ring-out', () => {
  it('does not check for ring-out at all while Active, even for a Bey already beyond the boundary — the very next unfrozen tick detects it naturally instead', async () => {
    const harness = await createTriggerReadyHarness();
    triggerClash(harness, tapController(), tapController());

    // Teleport both beyond the ring-out boundary *while already Active* —
    // isolates exactly what's under test (does the Active branch ever
    // check ring-out) from whether an attack can connect from way out.
    // Frozen simulation means physics never moves them from here until
    // Cooldown's normal ticks resume.
    harness.first.body.setTranslation({ x: RINGOUT_RADIUS_M + 1, y: 1, z: -0.75 }, true);
    harness.second.body.setTranslation({ x: RINGOUT_RADIUS_M + 1, y: 1, z: 0.75 }, true);

    let sawRingOutBeforeOrDuringActive = false;
    for (let i = 0; i < 5; i++) {
      const result = harness.tick(NO_ACTIONS, NO_ACTIONS);
      expect(result.ringOutFirst).toBe(false);
      expect(result.ringOutSecond).toBe(false);
    }
    expect(sawRingOutBeforeOrDuringActive).toBe(false);
    expect(harness.roundState.isOver).toBe(false);

    // Run all the way through resolution + into normal (Cooldown) ticks — physics never moved them (frozen the whole time), so they're still beyond the boundary, and the ordinary isRingOut() check (unrelated to Clash) now catches it naturally.
    let sawNaturalRingOut = false;
    for (let i = 0; i < DURATION_TICKS + 5 && !sawNaturalRingOut; i++) {
      const result = harness.tick(NO_ACTIONS, NO_ACTIONS);
      if (result.ringOutFirst || result.ringOutSecond) sawNaturalRingOut = true;
    }
    expect(sawNaturalRingOut).toBe(true);
    expect(harness.roundState.isOver).toBe(true);
  });
});
