// ============================================================
// MILESTONE 2 — COMBAT SELF-TEST SUITE (GDD section 151)
// Full-integration scenarios driven through the real tickMatch()
// orchestration via CombatHarness, exercising the actual Attack/Hit/
// Knockback/Stability/RingOut systems together rather than a simplified
// stand-in (GDD section 114/150).
// ============================================================

import { describe, expect, it } from 'vitest';
import { ARENA_FLOOR_RADIUS, ARENA_WALL_THICKNESS } from '../../src/arena/colliders/ArenaTuning';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { STABILITY_MAX } from '../../src/bey/stability/StabilityTuning';
import { CIRCULAR_STABILITY_DAMAGE } from '../../src/combat/attacks/AttackTuning';
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

// Close enough for both Circular (reach 1.8m) and Dash (reach 1.6m)
// hitboxes to land without requiring the attacker to close any distance
// first — isolates the attack/hit-detection/knockback flow from the
// movement prototype it sits on top of.
const CLOSE_FIRST_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -0.75 };
const CLOSE_SECOND_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0.75 };

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

/** Held past TAP_MAX_HOLD_S then released — commits to a charged Dash Attack. */
function chargedDashController(holdTicks: number): ScriptedController {
  return new ScriptedController([
    { fromTick: 0, held: [Action.Attack] },
    { fromTick: holdTicks, held: [] },
  ]);
}

/** Same as tapController(), but the tap starts at a chosen tick — for timing a Circular Attack to overlap a specific window (e.g. an opponent's Dash Attack). */
function delayedTapController(pressAtTick: number): ScriptedController {
  return new ScriptedController([
    { fromTick: pressAtTick, held: [Action.Attack] },
    { fromTick: pressAtTick + 2, held: [] },
  ]);
}

function repeatedTapFrames(count: number, intervalTicks: number): ScriptedFrame[] {
  const frames: ScriptedFrame[] = [];
  for (let i = 0; i < count; i++) {
    frames.push({ fromTick: i * intervalTicks, held: [Action.Attack] });
    frames.push({ fromTick: i * intervalTicks + 2, held: [] });
  }
  return frames;
}

describe('Circular Attack', () => {
  it('lands on a stationary idle opponent and damages their Stability', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    const attacker = tapController();
    let sawCircularHit = false;

    for (let i = 0; i < 60; i++) {
      const result = harness.tick(attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      for (const hit of result.hitEvents) {
        if (hit.attackerIsFirst && hit.hitbox.kind === 'circular') sawCircularHit = true;
      }
    }

    expect(sawCircularHit).toBe(true);
    expect(harness.second.stability.resource.fraction).toBeLessThan(1);
  });
});

describe('Dash Attack', () => {
  it('lands on a stationary idle opponent when charged and released within reach', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    const attacker = chargedDashController(20);
    let sawDashHit = false;
    let sawDashActive = false;

    for (let i = 0; i < 90; i++) {
      const result = harness.tick(attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (result.first.attackState === AttackState.DashActive) sawDashActive = true;
      for (const hit of result.hitEvents) {
        if (hit.attackerIsFirst && hit.hitbox.kind === 'dash') sawDashHit = true;
      }
    }

    expect(sawDashActive).toBe(true);
    expect(sawDashHit).toBe(true);
    expect(harness.second.stability.resource.fraction).toBeLessThan(1);
  });

  it('can miss an opponent that is out of reach, then recovers back to Neutral', async () => {
    // Max dash travel over its whole active window (18 m/s * 0.5s = 9m) is
    // well short of this 16m gap — guarantees a whiff regardless of the
    // lock-on turn-rate guidance.
    const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -8 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 8 });
    settle(harness);

    const attacker = chargedDashController(30);
    let sawAnyHit = false;
    let sawDashActive = false;

    for (let i = 0; i < 220; i++) {
      const result = harness.tick(attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (result.first.attackState === AttackState.DashActive) sawDashActive = true;
      if (result.hitEvents.length > 0) sawAnyHit = true;
    }

    expect(sawDashActive).toBe(true);
    expect(sawAnyHit).toBe(false);
    expect(harness.first.attack.getState()).toBe(AttackState.Neutral);
    expect(harness.second.stability.resource.fraction).toBe(1);
  });
});

describe('Stability Break (Model C)', () => {
  it('falls with repeated hits, breaks, and only a later qualifying hit while Broken causes a KO', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // Enough taps (well beyond STABILITY_MAX / CIRCULAR_STABILITY_DAMAGE)
    // spaced far enough apart that each tap's Buffer/Active/Recovery cycle
    // always finishes before the next one starts, and short enough apart
    // that Stability's post-hit recovery delay never kicks in between hits.
    const hitsNeededToBreak = Math.ceil(STABILITY_MAX / CIRCULAR_STABILITY_DAMAGE);
    const attacker = new ScriptedController(repeatedTapFrames(hitsNeededToBreak + 4, 40));

    let previousStabilityFraction = 1;
    let sawMonotonicDecrease = false;
    let brokenAtTick: number | null = null;
    let roundOverAtBrokenTick = true;
    let koAtTick: number | null = null;

    for (let i = 0; i < (hitsNeededToBreak + 4) * 40; i++) {
      const result = harness.tick(attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);

      if (result.second.stabilityFraction < previousStabilityFraction) sawMonotonicDecrease = true;
      previousStabilityFraction = result.second.stabilityFraction;

      if (brokenAtTick === null && result.second.isBroken) {
        brokenAtTick = i;
        roundOverAtBrokenTick = harness.roundState.isOver;
      }
      if (koAtTick === null && harness.roundState.isOver) {
        koAtTick = i;
      }

      // The stand-in opponent (IdleController) never chases (real AI is
      // Milestone 7) and each landed hit's knockback pushes it out of
      // reach — put it back in range after each hit so the scripted
      // repeated taps keep landing, isolating the Stability/Break/KO flow
      // from the movement prototype it sits on top of.
      if (result.hitEvents.some((hit) => hit.attackerIsFirst)) {
        harness.second.body.setTranslation(CLOSE_SECOND_SPAWN, true);
        harness.second.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        harness.second.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    expect(sawMonotonicDecrease).toBe(true);
    expect(brokenAtTick).not.toBeNull();
    // Reaching Break by itself must not end the round (Model C) — only a
    // later qualifying hit while already Broken does.
    expect(roundOverAtBrokenTick).toBe(false);
    expect(koAtTick).not.toBeNull();
    expect(koAtTick as number).toBeGreaterThan(brokenAtTick as number);
    expect(harness.roundState.result).toBe(RoundOutcome.FirstWinsByKo);
  });
});

describe('wall collision after knockback', () => {
  it('stays physically valid (finite, bounded) after a hit launches the defender into the wall', async () => {
    // Defender spawns close to the wall; the attacker's Circular Attack
    // knocks them further outward (away from the attacker), straight into it.
    const harness = await CombatHarness.create(
      { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 9.8 },
      { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 11 },
    );
    settle(harness);

    const attacker = tapController();
    let sawWallImpactOnDefender = false;
    let maxDistanceFromCenter = 0;

    for (let i = 0; i < 300; i++) {
      const result = harness.tick(attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);

      const secondPos = harness.second.body.translation();
      expect(Number.isFinite(secondPos.x) && Number.isFinite(secondPos.y) && Number.isFinite(secondPos.z)).toBe(true);
      const secondVel = harness.second.body.linvel();
      expect(Number.isFinite(secondVel.x) && Number.isFinite(secondVel.y) && Number.isFinite(secondVel.z)).toBe(true);

      maxDistanceFromCenter = Math.max(maxDistanceFromCenter, Math.hypot(secondPos.x, secondPos.z));
      if (result.second.movement.impactDeltaSpeedMps > 0) sawWallImpactOnDefender = true;
    }

    expect(sawWallImpactOnDefender).toBe(true);
    // No tunneling through the wall from the knockback impulse.
    expect(maxDistanceFromCenter).toBeLessThan(ARENA_FLOOR_RADIUS + ARENA_WALL_THICKNESS + 1);
  });
});

describe('ring-out', () => {
  it('ends the round the moment a Bey is beyond the ring-out boundary', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    expect(harness.roundState.isOver).toBe(false);

    // Directly place the second Bey beyond the ring-out radius, exactly
    // like a strong knockback launch would end up (GDD section 130:
    // ring-out is a pure position check, independent of how the Bey got
    // there, and deliberately not derived from the arena wall collider —
    // this expectation must not move if the physical arena's size ever
    // does).
    harness.second.body.setTranslation({ x: RINGOUT_RADIUS_M + 1, y: 1, z: 0 }, true);

    const result = harness.tick(NO_ACTIONS, NO_ACTIONS);

    expect(result.ringOutSecond).toBe(true);
    expect(harness.roundState.isOver).toBe(true);
    expect(harness.roundState.result).toBe(RoundOutcome.FirstWinsByRingOut);
  });

  it('resolves a genuinely simultaneous double-ring-out as a Draw, not tiebroken by check order', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    harness.first.body.setTranslation({ x: RINGOUT_RADIUS_M + 1, y: 1, z: 0 }, true);
    harness.second.body.setTranslation({ x: -(RINGOUT_RADIUS_M + 1), y: 1, z: 0 }, true);

    const result = harness.tick(NO_ACTIONS, NO_ACTIONS);

    expect(result.ringOutFirst).toBe(true);
    expect(result.ringOutSecond).toBe(true);
    expect(harness.roundState.isOver).toBe(true);
    expect(harness.roundState.result).toBe(RoundOutcome.Draw);
  });
});

describe('simultaneous double-KO', () => {
  it('resolves a genuinely simultaneous double-KO as a Draw, not tiebroken by hit-loop order', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // Pre-break both fighters directly (a pure system-level operation —
    // it never touches roundState) so a single further qualifying hit on
    // each is enough to KO both, without needing a long combat sequence
    // to reach Broken on both sides first.
    harness.first.stability.applyDamage(STABILITY_MAX);
    harness.second.stability.applyDamage(STABILITY_MAX);
    expect(harness.first.stability.isBroken).toBe(true);
    expect(harness.second.stability.isBroken).toBe(true);
    expect(harness.roundState.isOver).toBe(false);

    // Reset position/velocity so the pre-break impulse doesn't leave
    // anything mid-flight, then have both tap Circular Attack in lockstep
    // so both qualifying hits land on the exact same tick.
    harness.first.body.setTranslation(CLOSE_FIRST_SPAWN, true);
    harness.second.body.setTranslation(CLOSE_SECOND_SPAWN, true);
    harness.first.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    harness.second.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    const firstAttacker = tapController();
    const secondAttacker = tapController();

    for (let i = 0; i < 60 && !harness.roundState.isOver; i++) {
      harness.tick(
        firstAttacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        secondAttacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
    }

    expect(harness.roundState.isOver).toBe(true);
    expect(harness.roundState.result).toBe(RoundOutcome.Draw);
  });
});

describe('RoundEnd freezes the simulation', () => {
  it('stops advancing movement, attacks and resources once the round is over (Combat and RoundEnd are separate states)', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // End the round via ring-out, then keep feeding aggressive input.
    harness.second.body.setTranslation({ x: RINGOUT_RADIUS_M + 1, y: 1, z: 0 }, true);
    harness.tick(NO_ACTIONS, NO_ACTIONS);
    expect(harness.roundState.isOver).toBe(true);

    const frozenFirstPos = harness.first.body.translation();
    const frozenFirstPosSnapshot = { x: frozenFirstPos.x, y: frozenFirstPos.y, z: frozenFirstPos.z };
    const frozenSecondPos = harness.second.body.translation();
    const frozenSecondPosSnapshot = { x: frozenSecondPos.x, y: frozenSecondPos.y, z: frozenSecondPos.z };
    const frozenFirstStamina = harness.first.stamina.resource.fraction;
    const frozenSecondStability = harness.second.stability.resource.fraction;

    const attacker = tapController();
    let sawAnyHitAfterRoundEnd = false;

    for (let i = 0; i < 60; i++) {
      const result = harness.tick(
        attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        { held: new Set([Action.MoveForward]), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 },
      );
      if (result.hitEvents.length > 0) sawAnyHitAfterRoundEnd = true;
    }

    expect(sawAnyHitAfterRoundEnd).toBe(false);
    const finalFirstPos = harness.first.body.translation();
    expect({ x: finalFirstPos.x, y: finalFirstPos.y, z: finalFirstPos.z }).toEqual(frozenFirstPosSnapshot);
    const finalSecondPos = harness.second.body.translation();
    expect({ x: finalSecondPos.x, y: finalSecondPos.y, z: finalSecondPos.z }).toEqual(frozenSecondPosSnapshot);
    expect(harness.first.stamina.resource.fraction).toBe(frozenFirstStamina);
    expect(harness.second.stability.resource.fraction).toBe(frozenSecondStability);
    expect(harness.first.attack.getState()).toBe(AttackState.Neutral);
    expect(harness.roundState.result).toBe(RoundOutcome.FirstWinsByRingOut);
  });
});

describe('attacking mid-jump', () => {
  it('still hits within vertical reach and does not disrupt the jump trajectory', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    // A longer settle than the other tests need: the hop only triggers
    // once actually grounded, and the default settle() window still has
    // the Bey mid-fall (not yet in contact) at this spawn height.
    settle(harness, 40);

    // Hop first (a couple of ticks of pure JumpDrift, no steering — GDD
    // section 19 needs steering too to actually drift, we just want the
    // vertical hop here), then tap Circular Attack while still airborne.
    const attacker = new ScriptedController([
      { fromTick: 0, held: [Action.JumpDrift] },
      { fromTick: 2, held: [Action.Attack] },
      { fromTick: 4, held: [] },
    ]);

    let sawAirborne = false;
    let sawHitWhileAirborne = false;
    let previousVerticalVelocity: number | null = null;
    let maxVerticalVelocityDeltaWhileRising = 0;

    // Only the ascent/early-fall matters here — stop comfortably before
    // this particular hop's ground bounce (confirmed by tracing this exact
    // scenario), whose own legitimate velocity discontinuity would
    // otherwise be indistinguishable from "something disrupted the jump".
    for (let i = 0; i < 30; i++) {
      const result = harness.tick(attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      const verticalVelocity = harness.first.body.linvel().y;

      if (!result.first.grounded) {
        sawAirborne = true;
        if (result.hitEvents.some((hit) => hit.attackerIsFirst)) sawHitWhileAirborne = true;

        // Gravity alone should govern vertical velocity while airborne —
        // the attack/dash pipeline must never touch it.
        if (previousVerticalVelocity !== null) {
          const delta = Math.abs(verticalVelocity - previousVerticalVelocity);
          maxVerticalVelocityDeltaWhileRising = Math.max(maxVerticalVelocityDeltaWhileRising, delta);
        }
      }
      previousVerticalVelocity = verticalVelocity;
    }

    expect(sawAirborne).toBe(true);
    expect(sawHitWhileAirborne).toBe(true);
    // A per-tick vertical velocity change well beyond what gravity alone
    // produces in one fixed tick (~0.16 m/s at 60Hz) would mean something
    // other than gravity touched it — i.e. the attack disrupted the jump.
    expect(maxVerticalVelocityDeltaWhileRising).toBeLessThan(0.5);
  });
});

describe('Circular Attack catches Dash Attack', () => {
  it('launches the caught Dash attacker upward instead of applying normal knockback', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // second charges+releases a Dash Attack (active roughly ticks 20-49);
    // first's Circular Attack is timed to become active right as second's
    // Dash starts (roughly ticks 20-34), well inside that window.
    const dasher = chargedDashController(20);
    const catcher = delayedTapController(18);

    let sawCaughtDashHit = false;
    let maxSecondVerticalVelocity = 0;

    for (let i = 0; i < 60; i++) {
      const result = harness.tick(
        catcher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        dasher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      for (const hit of result.hitEvents) {
        if (hit.attackerIsFirst && hit.caughtOpponentDashing) sawCaughtDashHit = true;
      }
      maxSecondVerticalVelocity = Math.max(maxSecondVerticalVelocity, harness.second.body.linvel().y);
    }

    expect(sawCaughtDashHit).toBe(true);
    // A strong upward launch, not the shallow upward component normal
    // knockback also has — comfortably above what normal knockback alone
    // could produce here.
    expect(maxSecondVerticalVelocity).toBeGreaterThan(5);
    // Second wasn't already Broken, so this single hit shouldn't KO it.
    expect(harness.roundState.isOver).toBe(false);
  });

  it('still causes a KO when the caught defender was already Broken (a qualifying hit is a qualifying hit)', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // Pre-break the defender directly (a pure system-level operation — it
    // never touches roundState or physics), so the catch below is already
    // a qualifying KO hit.
    harness.second.stability.applyDamage(STABILITY_MAX);
    expect(harness.second.stability.isBroken).toBe(true);
    expect(harness.roundState.isOver).toBe(false);

    const dasher = chargedDashController(20);
    const catcher = delayedTapController(18);

    for (let i = 0; i < 60 && !harness.roundState.isOver; i++) {
      harness.tick(
        catcher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        dasher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
    }

    expect(harness.roundState.isOver).toBe(true);
    expect(harness.roundState.result).toBe(RoundOutcome.FirstWinsByKo);
  });
});

describe('RoundEnd freeze is genuinely read-only', () => {
  it('does not keep re-detecting the same impact once frozen (MovementController internal state must not mutate)', async () => {
    // Drive the first Bey straight into the wall to produce a real,
    // unresolved impact right as the round ends — the scenario that
    // exposed the bug: freezing while movement's own impact-detection
    // state was "hot".
    const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 }, CLOSE_SECOND_SPAWN);
    settle(harness);

    const driver = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);

    let sawRealImpact = false;
    for (let i = 0; i < 400 && !sawRealImpact; i++) {
      const result = harness.tick(driver.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (result.first.movement.impactDeltaSpeedMps > 0) sawRealImpact = true;
    }
    expect(sawRealImpact).toBe(true);
    expect(harness.roundState.isOver).toBe(false);

    // End the round immediately, on the very next tick, while that impact
    // is still fresh — this is the moment the old buildFrozenSnapshot()
    // would have kept re-reporting a "new" impact every subsequent tick.
    harness.second.body.setTranslation({ x: RINGOUT_RADIUS_M + 1, y: 1, z: 0 }, true);
    harness.tick(NO_ACTIONS, NO_ACTIONS);
    expect(harness.roundState.isOver).toBe(true);

    for (let i = 0; i < 20; i++) {
      const result = harness.tick(NO_ACTIONS, NO_ACTIONS);
      expect(result.first.movement.impactDeltaSpeedMps).toBe(0);
    }
  });

  it('keeps every frozen tick byte-for-byte identical across many repeats (no observable internal drift)', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    harness.second.body.setTranslation({ x: RINGOUT_RADIUS_M + 1, y: 1, z: 0 }, true);
    harness.tick(NO_ACTIONS, NO_ACTIONS); // ends the round this tick — not yet a frozen tick itself
    expect(harness.roundState.isOver).toBe(true);

    const attacker = tapController();
    const firstFrozenResult = harness.tick(attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
    let previous = JSON.stringify(firstFrozenResult.first.movement);
    for (let i = 0; i < 30; i++) {
      const result = harness.tick(attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      const current = JSON.stringify(result.first.movement);
      expect(current).toBe(previous);
      previous = current;
    }
  });
});
