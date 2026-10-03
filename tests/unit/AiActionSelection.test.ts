// ============================================================
// AI ACTION SELECTION — UNIT TESTS (MILESTONE 7)
// Pure/synthetic WorldState inputs (no physics) — verifies each AiIntent
// maps to the correct ControllerActions contract: held/pressedThisFrame
// are valid Sets, pressedThisFrame is always a subset of held, and the
// specific buttons pressed match what that intent should do (GDD section
// 113's shared controller contract).
// ============================================================

import { describe, expect, it } from 'vitest';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
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
    dashReadiness: 1,
    airRecoveryAvailable: false,
    canAffordDodge: true,
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
    const tick1 = selector.selectActions(AiIntent.AttackCircular, world({ attackState: AttackState.Neutral }), ATTACK_AI_PERSONALITY, false, 1 / 60);
    assertValidContract(tick1);
    expect(tick1.pressedThisFrame.has(Action.Attack)).toBe(true);

    // Once the real AttackController has moved on to Buffering, the
    // selector must not keep pressing Attack (that would turn a tap into a
    // Dash charge) — it reads the real state, not its own duplicate timer.
    const tick2 = selector.selectActions(AiIntent.AttackCircular, world({ attackState: AttackState.Buffering }), ATTACK_AI_PERSONALITY, false, 1 / 60);
    assertValidContract(tick2);
    expect(tick2.held.has(Action.Attack)).toBe(false);
  });

  it('holds Attack while charging a Dash below the personality-derived target charge, and stops holding once reached', () => {
    const selector = new ActionSelector();
    const chargingLow = selector.selectActions(
      AiIntent.AttackDash,
      // Opponent straight ahead (heading 0 faces +Z) so only the charge
      // target decides — see the alignment test below for the other gate.
      world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.1, dashReadiness: 1 }, { positionXZ: { x: 0, z: 5 } }),
      ATTACK_AI_PERSONALITY,
      false,
      1 / 60,
    );
    assertValidContract(chargingLow);
    expect(chargingLow.held.has(Action.Attack)).toBe(true);

    const chargedEnough = selector.selectActions(
      AiIntent.AttackDash,
      world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.99, dashReadiness: 1 }, { positionXZ: { x: 0, z: 5 } }),
      ATTACK_AI_PERSONALITY,
      false,
      1 / 60,
    );
    assertValidContract(chargedEnough);
    expect(chargedEnough.held.has(Action.Attack)).toBe(false);
  });

  it('PressAdvantage actually attacks — taps Circular at close range', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(
      AiIntent.PressAdvantage,
      world({ attackState: AttackState.Neutral }, { positionXZ: { x: 1, z: 0 }, isBroken: true, stabilityFraction: 0 }),
      ATTACK_AI_PERSONALITY,
      false,
      1 / 60,
    );
    assertValidContract(actions);
    expect(actions.pressedThisFrame.has(Action.Attack)).toBe(true);
  });

  it('PressAdvantage actually attacks — charges a Dash at medium range', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(
      AiIntent.PressAdvantage,
      world({ attackState: AttackState.Neutral, dashReadiness: 1 }, { positionXZ: { x: 5, z: 0 }, isBroken: true, stabilityFraction: 0 }),
      ATTACK_AI_PERSONALITY,
      false,
      1 / 60,
    );
    assertValidContract(actions);
    expect(actions.held.has(Action.Attack)).toBe(true);
  });

  it('presses Dodge for DodgeThreat when the pre-rolled attempt succeeds and dodgeState is Idle', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(AiIntent.DodgeThreat, world({ dodgeState: DodgeState.Idle }), ATTACK_AI_PERSONALITY, true, 1 / 60);
    assertValidContract(actions);
    expect(actions.pressedThisFrame.has(Action.Dodge)).toBe(true);
  });

  it('never presses Dodge for DodgeThreat when the pre-rolled attempt fails', () => {
    const selector = new ActionSelector();
    for (let i = 0; i < 5; i++) {
      const actions = selector.selectActions(AiIntent.DodgeThreat, world({ dodgeState: DodgeState.Idle }), ATTACK_AI_PERSONALITY, false, 1 / 60);
      assertValidContract(actions);
      expect(actions.held.has(Action.Dodge)).toBe(false);
    }
  });

  it('never presses Dodge while dodgeState is not Idle, even when the attempt succeeded (respects cooldown — no cheating past it)', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(AiIntent.DodgeThreat, world({ dodgeState: DodgeState.Cooldown }), ATTACK_AI_PERSONALITY, true, 1 / 60);
    assertValidContract(actions);
    expect(actions.held.has(Action.Dodge)).toBe(false);
  });

  it('taps JumpDrift for UseJumpDrift when grounded and driftState is Idle', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(AiIntent.UseJumpDrift, world({ driftState: DriftState.Idle, grounded: true }), ATTACK_AI_PERSONALITY, false, 1 / 60);
    assertValidContract(actions);
    expect(actions.pressedThisFrame.has(Action.JumpDrift)).toBe(true);
  });

  it('does not attempt JumpDrift while airborne (driftState still Idle)', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(AiIntent.UseJumpDrift, world({ driftState: DriftState.Idle, grounded: false }), ATTACK_AI_PERSONALITY, false, 1 / 60);
    assertValidContract(actions);
    expect(actions.held.has(Action.JumpDrift)).toBe(false);
  });

  it('keeps holding JumpDrift through Hopping and Drifting for UseJumpDrift, so a real Hopping->Drifting transition is reachable', () => {
    const selector = new ActionSelector();
    const hopping = selector.selectActions(AiIntent.UseJumpDrift, world({ driftState: DriftState.Hopping, grounded: false }), ATTACK_AI_PERSONALITY, false, 1 / 60);
    assertValidContract(hopping);
    expect(hopping.held.has(Action.JumpDrift)).toBe(true);

    const drifting = selector.selectActions(AiIntent.UseJumpDrift, world({ driftState: DriftState.Drifting, grounded: true }), ATTACK_AI_PERSONALITY, false, 1 / 60);
    assertValidContract(drifting);
    expect(drifting.held.has(Action.JumpDrift)).toBe(true);
  });

  it('releases JumpDrift once the intent is no longer UseJumpDrift, even mid-Drifting', () => {
    const selector = new ActionSelector();
    selector.selectActions(AiIntent.UseJumpDrift, world({ driftState: DriftState.Drifting, grounded: true }), ATTACK_AI_PERSONALITY, false, 1 / 60);
    const afterIntentChanged = selector.selectActions(AiIntent.Circle, world({ driftState: DriftState.Recovering, grounded: true }), ATTACK_AI_PERSONALITY, false, 1 / 60);
    assertValidContract(afterIntentChanged);
    expect(afterIntentChanged.held.has(Action.JumpDrift)).toBe(false);
  });

  it('steers and moves forward toward the opponent for Approach', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(
      AiIntent.Approach,
      world({ positionXZ: { x: 0, z: 0 }, headingRad: 0 }, { positionXZ: { x: 5, z: 0 } }),
      ATTACK_AI_PERSONALITY,
      false,
      1 / 60,
    );
    assertValidContract(actions);
    expect(actions.held.has(Action.MoveForward)).toBe(true);
  });

  it('produces no movement/attack/dodge/jump actions for Wait', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(AiIntent.Wait, world({}), ATTACK_AI_PERSONALITY, false, 1 / 60);
    assertValidContract(actions);
    expect(actions.held.size).toBe(0);
  });

  it('repeatFrozenActions repeats held with no new presses and does not advance hold-duration clocks', () => {
    const selector = new ActionSelector();
    const before = selector.selectActions(
      AiIntent.AttackDash,
      world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.1 }),
      ATTACK_AI_PERSONALITY,
      false,
      1 / 60,
    );
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

// ============================================================
// M7 Part 2 — execution: steering discipline, Dash release, counter
// timing, edge pressure. Heading 0 faces +Z (fromYaw convention).
// ============================================================

const DT = 1 / 60;

describe('ActionSelector — steering discipline (M7 Part 2)', () => {
  it('turns before throttling when an Approach target is behind, instead of driving forward away from it', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(AiIntent.Approach, world({ headingRad: 0 }, { positionXZ: { x: 0.3, z: -5 } }), ATTACK_AI_PERSONALITY, false, DT);
    assertValidContract(actions);
    expect(actions.held.has(Action.MoveForward)).toBe(false);
    expect(actions.held.has(Action.MoveBackward)).toBe(false);
    expect(actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight)).toBe(true);
  });

  it('reverses back toward the center for RecoverFromEdge when facing out of the ring', () => {
    const selector = new ActionSelector();
    // 1.9 m inside the ring-out radius facing +Z = facing straight at the boundary.
    const actions = selector.selectActions(
      AiIntent.RecoverFromEdge,
      world({ positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 1.9 }, headingRad: 0 }, { positionXZ: { x: 5, z: 0 } }),
      ATTACK_AI_PERSONALITY,
      false,
      DT,
    );
    assertValidContract(actions);
    expect(actions.held.has(Action.MoveBackward)).toBe(true);
    expect(actions.held.has(Action.MoveForward)).toBe(false);
  });

  it('never retreats straight out of the ring when the opponent is between it and the center', () => {
    const selector = new ActionSelector();
    // Own 1.9 m inside the ring-out radius facing the opponent (heading -90°
    // faces -X), opponent 2 m further in: "straight away" is straight out. Reversing would do exactly that.
    const actions = selector.selectActions(
      AiIntent.Retreat,
      world({ positionXZ: { x: RINGOUT_RADIUS_M - 1.9, z: 0 }, headingRad: -Math.PI / 2 }, { positionXZ: { x: RINGOUT_RADIUS_M - 3.9, z: 0 } }),
      ATTACK_AI_PERSONALITY,
      false,
      DT,
    );
    assertValidContract(actions);
    expect(actions.held.has(Action.MoveBackward)).toBe(false);
    expect(actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight)).toBe(true);
  });
});

describe('ActionSelector — Dash release (M7 Part 2)', () => {
  it('keeps charging past the charge target until the heading is on line, then releases', () => {
    const selector = new ActionSelector();
    const charged = { attackState: AttackState.ChargingDash, dashChargeFraction: 0.9, dashReadiness: 0.8 };

    const offLine = selector.selectActions(AiIntent.AttackDash, world(charged, { positionXZ: { x: 5, z: 0 } }), ATTACK_AI_PERSONALITY, false, DT);
    expect(offLine.held.has(Action.Attack)).toBe(true);

    const onLine = selector.selectActions(AiIntent.AttackDash, world(charged, { positionXZ: { x: 0, z: 5 } }), ATTACK_AI_PERSONALITY, false, DT);
    expect(onLine.held.has(Action.Attack)).toBe(false);
  });

  it('starts a fresh Dash from Neutral even though the previous Dash reached its charge target (regression: one Dash per match)', () => {
    const selector = new ActionSelector();
    // Raw charge 0.6 is the stale value AttackController keeps reporting
    // after a Dash; perception must not read it as "already charged".
    const actions = selector.selectActions(
      AiIntent.AttackDash,
      world({ attackState: AttackState.Neutral, dashChargeFraction: 0.6 }, { positionXZ: { x: 0, z: 5 } }),
      ATTACK_AI_PERSONALITY,
      false,
      DT,
    );
    expect(actions.pressedThisFrame.has(Action.Attack)).toBe(true);
  });
});

describe('ActionSelector — Circular counter timing (M7 Part 2)', () => {
  function incomingDash(distanceM: number): WorldState {
    // Opponent dashing straight at own position at 15 m/s.
    return world({}, { positionXZ: { x: 0, z: distanceM }, velocityXZ: { x: 0, z: -15 }, attackState: AttackState.DashActive, dashChargeFraction: 0.5 });
  }

  it('holds ground (no tap) while the incoming dasher is still too far to be caught', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(AiIntent.CounterAttack, incomingDash(6), ATTACK_AI_PERSONALITY, false, DT);
    assertValidContract(actions);
    expect(actions.held.size).toBe(0);
  });

  it('taps Circular once the dasher is about to enter reach', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(AiIntent.CounterAttack, incomingDash(4.5), ATTACK_AI_PERSONALITY, false, DT);
    assertValidContract(actions);
    expect(actions.pressedThisFrame.has(Action.Attack)).toBe(true);
  });

  it('does not tap against a Dash that is not closing in', () => {
    const selector = new ActionSelector();
    const passing = world({}, { positionXZ: { x: 0, z: 3 }, velocityXZ: { x: 15, z: 0 }, attackState: AttackState.DashActive });
    const actions = selector.selectActions(AiIntent.CounterAttack, passing, ATTACK_AI_PERSONALITY, false, DT);
    expect(actions.held.has(Action.Attack)).toBe(false);
  });
});

describe('ActionSelector — edge pressure (M7 Part 2)', () => {
  // Opponent near the +X edge; "center side" means own sits at smaller x.
  const nearEdgeOpponent = { positionXZ: { x: RINGOUT_RADIUS_M - 1.9, z: 0 }, isBroken: false };

  it('does not swing from the outside/flank — moves around toward the center side first', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(
      AiIntent.PressAdvantage,
      world({ positionXZ: { x: RINGOUT_RADIUS_M - 1.9, z: 1.8 }, headingRad: Math.PI }, nearEdgeOpponent),
      ATTACK_AI_PERSONALITY,
      false,
      DT,
    );
    assertValidContract(actions);
    expect(actions.held.has(Action.Attack)).toBe(false);
  });

  it('swings once center-side, so the hit drives the opponent outward', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(
      AiIntent.PressAdvantage,
      world({ positionXZ: { x: RINGOUT_RADIUS_M - 3.7, z: 0 }, headingRad: Math.PI / 2 }, nearEdgeOpponent),
      ATTACK_AI_PERSONALITY,
      false,
      DT,
    );
    assertValidContract(actions);
    expect(actions.pressedThisFrame.has(Action.Attack)).toBe(true);
  });
});

describe('ActionSelector — Clash-mash held state must not leak into normal combat (M7 audit regression)', () => {
  // AIController.sampleClashMashActions holds a raw Set of Clash-mash
  // actions (Attack/JumpDrift/Dodge) through this exact same
  // ActionSelector.commit() bookkeeping — see ClashOrchestration/ClashMash.
  // If that commit() call shares an ActionSelector instance with the one
  // driving normal-combat selectActions(), an Attack the mash happened to
  // be holding right up to the Clash's resolution stays in "already
  // held" bookkeeping, so the very next real AttackCircular decision
  // produces no fresh pressedThisFrame press — AttackController.tick()
  // only starts an attack from Neutral on a real press, never from held
  // alone (see AttackController.ts), so the attack is silently swallowed.
  it('a shared selector swallows the next real Attack press right after a Clash-mash Attack hold (documents the bug)', () => {
    const shared = new ActionSelector();
    shared.commit(new Set([Action.Attack]), DT); // last Clash-mash tick happened to hold Attack.
    const postClash = shared.selectActions(AiIntent.AttackCircular, world({ attackState: AttackState.Neutral }), ATTACK_AI_PERSONALITY, false, DT);
    expect(postClash.held.has(Action.Attack)).toBe(true);
    expect(postClash.pressedThisFrame.has(Action.Attack)).toBe(false); // the bug: no fresh press reaches AttackController.
  });

  it('separate selectors (the fix) let the same post-Clash decision press Attack for real', () => {
    const mashSelector = new ActionSelector();
    mashSelector.commit(new Set([Action.Attack]), DT); // same Clash-mash Attack hold as above, on its own selector.
    const normalSelector = new ActionSelector();
    const postClash = normalSelector.selectActions(AiIntent.AttackCircular, world({ attackState: AttackState.Neutral }), ATTACK_AI_PERSONALITY, false, DT);
    expect(postClash.pressedThisFrame.has(Action.Attack)).toBe(true);
  });
});

describe('ActionSelector — dedicated Clash-mash selector must reset between separate Clashes (M7 audit follow-up)', () => {
  // Review finding on the fix above: giving the Clash-mash path its own
  // ActionSelector stops it leaking into normal combat, but nothing calls
  // commit() on that dedicated selector between Clashes (Cooldown/Idle,
  // normal combat) to clear it on its own. If Clash A's last mash tick
  // held Attack and Clash B's first mash tick also picks Attack, the
  // unreset selector still reads Attack as "already held" and swallows
  // that first mash event of Clash B — the same leak, just Clash-to-Clash
  // instead of Clash-to-normal-combat.
  it("without a reset, a repeated Attack mash across two Clashes loses the second Clash's first event (documents the gap)", () => {
    const mashSelector = new ActionSelector();
    mashSelector.commit(new Set([Action.Attack]), DT); // Clash A's last mash tick.
    // ... Clash A resolves, Cooldown elapses, Clash B starts — nothing
    // touches mashSelector in between (mirrors AIController's real flow
    // before the fix below).
    const clashBFirstMash = mashSelector.commit(new Set([Action.Attack]), DT); // Clash B's first mash tick, same action.
    expect(clashBFirstMash.pressedThisFrame.has(Action.Attack)).toBe(false); // the gap: Clash B's first mash event is lost.
  });

  it('reset() at the start of a new Clash (the fix) lets the same repeated Attack mash land as a fresh event', () => {
    const mashSelector = new ActionSelector();
    mashSelector.commit(new Set([Action.Attack]), DT); // Clash A's last mash tick.
    mashSelector.reset(); // AIController calls this on the Idle/Cooldown -> Active edge for the next Clash.
    const clashBFirstMash = mashSelector.commit(new Set([Action.Attack]), DT); // Clash B's first mash tick, same action.
    expect(clashBFirstMash.pressedThisFrame.has(Action.Attack)).toBe(true);
  });
});
