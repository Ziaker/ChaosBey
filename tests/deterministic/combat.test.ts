// ============================================================
// MILESTONE 2 — COMBAT SELF-TEST SUITE (GDD section 151)
// Full-integration scenarios driven through the real tickMatch()
// orchestration via CombatHarness, exercising the actual Attack/Hit/
// Knockback/Stability/RingOut systems together rather than a simplified
// stand-in (GDD section 114/150).
// ============================================================

import { describe, expect, it } from 'vitest';
import { ARENA_FLOOR_RADIUS, ARENA_WALL_THICKNESS } from '../../src/arena/colliders/ArenaTuning';
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

    // Directly place the second Bey beyond the wall + ring-out margin,
    // exactly like a strong knockback launch would end up (GDD section
    // 130: ring-out is a pure position check, independent of how the Bey
    // got there) — isolates the round-ending rule from knockback tuning.
    harness.second.body.setTranslation({ x: ARENA_FLOOR_RADIUS + ARENA_WALL_THICKNESS + 1, y: 1, z: 0 }, true);

    const result = harness.tick(NO_ACTIONS, NO_ACTIONS);

    expect(result.ringOutSecond).toBe(true);
    expect(harness.roundState.isOver).toBe(true);
    expect(harness.roundState.result).toBe(RoundOutcome.FirstWinsByRingOut);
  });
});
