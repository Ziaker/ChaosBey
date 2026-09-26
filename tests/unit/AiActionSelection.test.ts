// ============================================================
// AI ACTION SELECTION — UNIT TESTS (MILESTONE 7)
// Pure/synthetic WorldState inputs (no physics) — verifies each AiIntent
// maps to the correct ControllerActions contract: held/pressedThisFrame
// are valid Sets, pressedThisFrame is always a subset of held, and the
// specific buttons pressed match what that intent should do (GDD section
// 113's shared controller contract).
// ============================================================

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { Action } from '../../src/input/actions/Action';
import { ActionSelector } from '../../src/ai/decision/ActionSelection';
import { AiIntent } from '../../src/ai/decision/Intent';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { buildWorldState, type WorldState } from '../../src/ai/decision/WorldState';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { SeededRng } from '../../src/rng/SeededRng';

function rawState(overrides: Partial<CombatantRawState> = {}): CombatantRawState {
  return {
    positionXZ: { x: 0, z: 0 },
    velocityXZ: { x: 0, z: 0 },
    headingRad: 0,
    grounded: true,
    attackState: AttackState.Neutral,
    dashChargeFraction: 0,
    dodgeState: DodgeState.Idle,
    driftState: DriftState.Idle,
    staminaFraction: 1,
    stabilityFraction: 1,
    isBroken: false,
    attackEnergyFraction: 1,
    ...overrides,
  };
}

function world(ownOverrides: Partial<CombatantRawState>, opponentOverrides: Partial<CombatantRawState> = {}): WorldState {
  const own = perceiveCombatant(rawState(ownOverrides));
  const opponent = perceiveCombatant(rawState({ positionXZ: { x: 2, z: 0 }, ...opponentOverrides }));
  return buildWorldState(0, own, opponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
}

function assertValidContract(actions: ReturnType<ActionSelector['selectActions']>): void {
  expect(actions.held).toBeInstanceOf(Set);
  expect(actions.pressedThisFrame).toBeInstanceOf(Set);
  for (const action of actions.pressedThisFrame) {
    expect(actions.held.has(action)).toBe(true);
  }
  expect(Number.isFinite(actions.attackHoldDurationSeconds)).toBe(true);
  expect(actions.attackHoldDurationSeconds).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(actions.jumpDriftHoldDurationSeconds)).toBe(true);
  expect(actions.jumpDriftHoldDurationSeconds).toBeGreaterThanOrEqual(0);
}

describe('ActionSelector', () => {
  it('taps Attack exactly once (held then released) for AttackCircular from Neutral', () => {
    const selector = new ActionSelector();
    const rng = SeededRng.fromSeedText('action-selection-circular');
    const tick1 = selector.selectActions(AiIntent.AttackCircular, world({ attackState: AttackState.Neutral }), ATTACK_AI_PERSONALITY, rng, 1 / 60);
    assertValidContract(tick1);
    expect(tick1.pressedThisFrame.has(Action.Attack)).toBe(true);

    // Once the real AttackController has moved on to Buffering, the
    // selector must not keep pressing Attack (that would turn a tap into a
    // Dash charge) — it reads the real state, not its own duplicate timer.
    const tick2 = selector.selectActions(AiIntent.AttackCircular, world({ attackState: AttackState.Buffering }), ATTACK_AI_PERSONALITY, rng, 1 / 60);
    assertValidContract(tick2);
    expect(tick2.held.has(Action.Attack)).toBe(false);
  });

  it('holds Attack while charging a Dash below the personality-derived target charge, and stops holding once reached', () => {
    const selector = new ActionSelector();
    const rng = SeededRng.fromSeedText('action-selection-dash');
    const chargingLow = selector.selectActions(
      AiIntent.AttackDash,
      world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.1, attackEnergyFraction: 1 }),
      ATTACK_AI_PERSONALITY,
      rng,
      1 / 60,
    );
    assertValidContract(chargingLow);
    expect(chargingLow.held.has(Action.Attack)).toBe(true);

    const chargedEnough = selector.selectActions(
      AiIntent.AttackDash,
      world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.99, attackEnergyFraction: 1 }),
      ATTACK_AI_PERSONALITY,
      rng,
      1 / 60,
    );
    assertValidContract(chargedEnough);
    expect(chargedEnough.held.has(Action.Attack)).toBe(false);
  });

  it('presses Dodge for DodgeThreat when dodgeSkill rolls favorably and dodgeState is Idle', () => {
    const selector = new ActionSelector();
    const alwaysDodgePersonality = { ...ATTACK_AI_PERSONALITY, dodgeSkill: 1 };
    const rng = SeededRng.fromSeedText('action-selection-dodge');
    const actions = selector.selectActions(AiIntent.DodgeThreat, world({ dodgeState: DodgeState.Idle }), alwaysDodgePersonality, rng, 1 / 60);
    assertValidContract(actions);
    expect(actions.pressedThisFrame.has(Action.Dodge)).toBe(true);
  });

  it('never presses Dodge for DodgeThreat when dodgeSkill is 0', () => {
    const selector = new ActionSelector();
    const neverDodgePersonality = { ...ATTACK_AI_PERSONALITY, dodgeSkill: 0 };
    const rng = SeededRng.fromSeedText('action-selection-no-dodge');
    for (let i = 0; i < 20; i++) {
      const actions = selector.selectActions(AiIntent.DodgeThreat, world({ dodgeState: DodgeState.Idle }), neverDodgePersonality, rng, 1 / 60);
      assertValidContract(actions);
      expect(actions.held.has(Action.Dodge)).toBe(false);
    }
  });

  it('never presses Dodge while dodgeState is not Idle (respects cooldown — no cheating past it)', () => {
    const selector = new ActionSelector();
    const alwaysDodgePersonality = { ...ATTACK_AI_PERSONALITY, dodgeSkill: 1 };
    const rng = SeededRng.fromSeedText('action-selection-dodge-cooldown');
    const actions = selector.selectActions(AiIntent.DodgeThreat, world({ dodgeState: DodgeState.Cooldown }), alwaysDodgePersonality, rng, 1 / 60);
    assertValidContract(actions);
    expect(actions.held.has(Action.Dodge)).toBe(false);
  });

  it('taps JumpDrift for UseJumpDrift when grounded and driftState is Idle', () => {
    const selector = new ActionSelector();
    const rng = SeededRng.fromSeedText('action-selection-jump');
    const actions = selector.selectActions(AiIntent.UseJumpDrift, world({ driftState: DriftState.Idle, grounded: true }), ATTACK_AI_PERSONALITY, rng, 1 / 60);
    assertValidContract(actions);
    expect(actions.pressedThisFrame.has(Action.JumpDrift)).toBe(true);
  });

  it('does not attempt JumpDrift while airborne', () => {
    const selector = new ActionSelector();
    const rng = SeededRng.fromSeedText('action-selection-jump-airborne');
    const actions = selector.selectActions(AiIntent.UseJumpDrift, world({ driftState: DriftState.Idle, grounded: false }), ATTACK_AI_PERSONALITY, rng, 1 / 60);
    assertValidContract(actions);
    expect(actions.held.has(Action.JumpDrift)).toBe(false);
  });

  it('steers and moves forward toward the opponent for Approach', () => {
    const selector = new ActionSelector();
    const rng = SeededRng.fromSeedText('action-selection-approach');
    const actions = selector.selectActions(AiIntent.Approach, world({ positionXZ: { x: 0, z: 0 }, headingRad: 0 }, { positionXZ: { x: 5, z: 0 } }), ATTACK_AI_PERSONALITY, rng, 1 / 60);
    assertValidContract(actions);
    expect(actions.held.has(Action.MoveForward)).toBe(true);
  });

  it('produces no movement/attack/dodge/jump actions for Wait', () => {
    const selector = new ActionSelector();
    const rng = SeededRng.fromSeedText('action-selection-wait');
    const actions = selector.selectActions(AiIntent.Wait, world({}), ATTACK_AI_PERSONALITY, rng, 1 / 60);
    assertValidContract(actions);
    expect(actions.held.size).toBe(0);
  });

  it('repeatFrozenActions repeats held with no new presses and does not advance hold-duration clocks', () => {
    const selector = new ActionSelector();
    const rng = SeededRng.fromSeedText('action-selection-frozen');
    const before = selector.selectActions(AiIntent.AttackDash, world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.1 }), ATTACK_AI_PERSONALITY, rng, 1 / 60);
    expect(before.held.has(Action.Attack)).toBe(true);

    const frozen1 = selector.repeatFrozenActions(1 / 60);
    const frozen2 = selector.repeatFrozenActions(1 / 60);
    assertValidContract(frozen1);
    assertValidContract(frozen2);
    expect(frozen1.held.has(Action.Attack)).toBe(true);
    expect(frozen1.pressedThisFrame.size).toBe(0);
    expect(frozen2.pressedThisFrame.size).toBe(0);
    // Frozen ticks must not let the charge clock keep climbing.
    expect(frozen2.attackHoldDurationSeconds).toBe(frozen1.attackHoldDurationSeconds);
  });
});
