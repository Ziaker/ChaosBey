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
    dodgeReady: true,
    airRecoveryAvailable: false,
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
      world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.1, attackEnergyFraction: 1 }, { positionXZ: { x: 0, z: 5 } }),
      ATTACK_AI_PERSONALITY,
      false,
      1 / 60,
    );
    assertValidContract(chargingLow);
    expect(chargingLow.held.has(Action.Attack)).toBe(true);

    const chargedEnough = selector.selectActions(
      AiIntent.AttackDash,
      world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.99, attackEnergyFraction: 1 }, { positionXZ: { x: 0, z: 5 } }),
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
      world({ attackState: AttackState.Neutral, attackEnergyFraction: 1 }, { positionXZ: { x: 5, z: 0 }, isBroken: true, stabilityFraction: 0 }),
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
    // At z=11 facing +Z = facing straight at the boundary.
    const actions = selector.selectActions(
      AiIntent.RecoverFromEdge,
      world({ positionXZ: { x: 0, z: 11 }, headingRad: 0 }, { positionXZ: { x: 5, z: 0 } }),
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
    // Own at x=11 facing the opponent (heading -90° faces -X), opponent at
    // x=9: "straight away" is straight out. Reversing would do exactly that.
    const actions = selector.selectActions(
      AiIntent.Retreat,
      world({ positionXZ: { x: 11, z: 0 }, headingRad: -Math.PI / 2 }, { positionXZ: { x: 9, z: 0 } }),
      ATTACK_AI_PERSONALITY,
      false,
      DT,
    );
    assertValidContract(actions);
    expect(actions.held.has(Action.MoveBackward)).toBe(false);
    expect(actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight)).toBe(true);
  });

  it('never retreats straight out of the ring at moderate edge risk either (regression: re-normalizing a trimmed outward direction)', () => {
    const selector = new ActionSelector();
    // Own at x=10.6 (raw edge risk ~0.34) facing straight out (+X), opponent
    // on the center side: "away" is straight out. The old trim-and-normalize
    // gave back exactly that — MoveForward with no steering, out of the ring.
    const actions = selector.selectActions(
      AiIntent.Retreat,
      world({ positionXZ: { x: 10.6, z: 0 }, headingRad: Math.PI / 2 }, { positionXZ: { x: 8, z: 0 } }),
      ATTACK_AI_PERSONALITY,
      false,
      DT,
    );
    assertValidContract(actions);
    expect(actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight), 'turns toward the edge tangent').toBe(true);
  });
});

describe('ActionSelector — Dash release (M7 Part 2)', () => {
  it('keeps charging past the charge target until the heading is on line, then releases', () => {
    const selector = new ActionSelector();
    const charged = { attackState: AttackState.ChargingDash, dashChargeFraction: 0.9, attackEnergyFraction: 0.8 };

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
  const nearEdgeOpponent = { positionXZ: { x: 11, z: 0 }, isBroken: false };

  it('does not swing from the outside/flank — moves around toward the center side first', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(
      AiIntent.PressAdvantage,
      world({ positionXZ: { x: 11, z: 1.8 }, headingRad: Math.PI }, nearEdgeOpponent),
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
      world({ positionXZ: { x: 9.2, z: 0 }, headingRad: Math.PI / 2 }, nearEdgeOpponent),
      ATTACK_AI_PERSONALITY,
      false,
      DT,
    );
    assertValidContract(actions);
    expect(actions.pressedThisFrame.has(Action.Attack)).toBe(true);
  });
});

// ============================================================
// M7 Part 2b — dodge direction and JumpEvade execution.
// The burst direction is recomputed here INDEPENDENTLY from the held keys,
// the way DodgeController.applyBurst reads them (forward = sin/cos of
// heading, right = +90°), so these tests check the effective input, not
// the selector's own arithmetic.
// ============================================================

function burstFromHeldKeys(held: ReadonlySet<Action>, headingRad: number): { x: number; z: number } {
  const forwardInput = (held.has(Action.MoveForward) ? 1 : 0) - (held.has(Action.MoveBackward) ? 1 : 0);
  const lateralInput = (held.has(Action.SteerRight) ? 1 : 0) - (held.has(Action.SteerLeft) ? 1 : 0);
  const fx = Math.sin(headingRad);
  const fz = Math.cos(headingRad);
  let x = fx * forwardInput + fz * lateralInput;
  let z = fz * forwardInput - fx * lateralInput;
  if (forwardInput === 0 && lateralInput === 0) {
    x = fx;
    z = fz;
  }
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}

describe('ActionSelector — dodge direction (M7 Part 2b)', () => {
  it('near the edge, with the attacker between it and the center, dodges sideways/inward — never outward', () => {
    for (const headingRad of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
      const selector = new ActionSelector();
      const w = world({ positionXZ: { x: 0, z: 11 }, headingRad }, { positionXZ: { x: 0, z: 9.5 }, attackState: AttackState.CircularActive });
      const actions = selector.selectActions(AiIntent.DodgeThreat, w, ATTACK_AI_PERSONALITY, true, DT);
      assertValidContract(actions);
      expect(actions.pressedThisFrame.has(Action.Dodge)).toBe(true);
      const burst = burstFromHeldKeys(actions.held, headingRad);
      // Outward here is +Z. At most slightly outward (cos <= 0.2).
      expect(burst.z, `heading ${headingRad}`).toBeLessThanOrEqual(0.2);
    }
  });

  it('away from the edge, sidesteps off the attack line instead of dodging along it', () => {
    const selector = new ActionSelector();
    const w = world({ positionXZ: { x: 0, z: 0 }, headingRad: 0 }, { positionXZ: { x: 0, z: 3 }, attackState: AttackState.DashActive, velocityXZ: { x: 0, z: -15 } });
    const actions = selector.selectActions(AiIntent.DodgeThreat, w, ATTACK_AI_PERSONALITY, true, DT);
    const burst = burstFromHeldKeys(actions.held, 0);
    // Attack line is Z; a sidestep is mostly X.
    expect(Math.abs(burst.z)).toBeLessThan(0.75);
    expect(burst.z).toBeLessThanOrEqual(0); // never toward the attacker
  });

  it('never presses Dodge when Stamina is below the cost (dodgeReady false), even in Idle', () => {
    const selector = new ActionSelector();
    const w = world({ dodgeState: DodgeState.Idle, dodgeReady: false }, { positionXZ: { x: 0, z: 1.5 }, attackState: AttackState.CircularActive });
    const actions = selector.selectActions(AiIntent.DodgeThreat, w, ATTACK_AI_PERSONALITY, true, DT);
    expect(actions.held.has(Action.Dodge)).toBe(false);
  });
});

describe('ActionSelector — JumpEvade (M7 Part 2b)', () => {
  it('holds JumpDrift with no steering (full-height jump, never a drift) and throttles toward the safe side', () => {
    const selector = new ActionSelector();
    // At z=11 facing +Z (outward), attacker from the center side: the safe
    // side is sideways/inward, so the throttle must not be MoveForward (out).
    const w = world({ positionXZ: { x: 0, z: 11 }, headingRad: 0 }, { positionXZ: { x: 0.8, z: 9.5 }, attackState: AttackState.CircularActive });
    const actions = selector.selectActions(AiIntent.JumpEvade, w, ATTACK_AI_PERSONALITY, false, DT);
    assertValidContract(actions);
    expect(actions.pressedThisFrame.has(Action.JumpDrift)).toBe(true);
    expect(actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight)).toBe(false);
    expect(actions.held.has(Action.MoveForward)).toBe(false);
  });

  it('does not throttle outward at moderate edge risk either — jumps in place rather than along the attack line or out', () => {
    const selector = new ActionSelector();
    // z=10.6 (raw edge risk ~0.34) facing +Z (outward), attacker straight in
    // from the center: forward is out, backward is into the attack line.
    const w = world({ positionXZ: { x: 0, z: 10.6 }, headingRad: 0 }, { positionXZ: { x: 0, z: 8 }, attackState: AttackState.DashActive });
    const actions = selector.selectActions(AiIntent.JumpEvade, w, ATTACK_AI_PERSONALITY, false, DT);
    expect(actions.pressedThisFrame.has(Action.JumpDrift)).toBe(true);
    expect(actions.held.has(Action.MoveForward)).toBe(false);
    expect(actions.held.has(Action.MoveBackward)).toBe(false);
  });

  it('keeps holding JumpDrift through Hopping (variable-jump height) and does not re-press after landing', () => {
    const selector = new ActionSelector();
    const threat = { positionXZ: { x: 0, z: 2 }, attackState: AttackState.CircularActive };
    const first = selector.selectActions(AiIntent.JumpEvade, world({}, threat), ATTACK_AI_PERSONALITY, false, DT);
    const hopping = selector.selectActions(AiIntent.JumpEvade, world({ driftState: DriftState.Hopping, grounded: false }, threat), ATTACK_AI_PERSONALITY, false, DT);
    const landed = selector.selectActions(AiIntent.JumpEvade, world({ driftState: DriftState.Idle, grounded: true }, threat), ATTACK_AI_PERSONALITY, false, DT);
    expect(first.pressedThisFrame.has(Action.JumpDrift)).toBe(true);
    expect(hopping.held.has(Action.JumpDrift)).toBe(true);
    expect(hopping.pressedThisFrame.has(Action.JumpDrift)).toBe(false);
    expect(landed.pressedThisFrame.has(Action.JumpDrift)).toBe(false);
  });
});

describe('ActionSelector — AirRecover (M7 Part 2b)', () => {
  const launched = { grounded: false, airRecoveryAvailable: true };

  it('presses Dodge once inside the window, and lets go the tick the window closes (used)', () => {
    const selector = new ActionSelector();
    const open = selector.selectActions(AiIntent.AirRecover, world(launched), ATTACK_AI_PERSONALITY, false, DT);
    assertValidContract(open);
    expect(open.pressedThisFrame.has(Action.Dodge)).toBe(true);
    const closed = selector.selectActions(AiIntent.AirRecover, world({ grounded: false, airRecoveryAvailable: false }), ATTACK_AI_PERSONALITY, false, DT);
    expect(closed.held.has(Action.Dodge)).toBe(false);
  });

  it('never presses Dodge once grounded — on the ground that press would be a ground dodge, not a recovery', () => {
    const selector = new ActionSelector();
    const landed = selector.selectActions(AiIntent.AirRecover, world({ grounded: true, airRecoveryAvailable: true }), ATTACK_AI_PERSONALITY, false, DT);
    expect(landed.held.has(Action.Dodge)).toBe(false);
  });

  it('never presses Dodge in the air for any other intent (no general air dodge)', () => {
    for (const intent of Object.values(AiIntent)) {
      if (intent === AiIntent.AirRecover) continue;
      const selector = new ActionSelector();
      const actions = selector.selectActions(intent, world({ grounded: false, airRecoveryAvailable: true }, { positionXZ: { x: 1.5, z: 0 }, attackState: AttackState.CircularActive }), ATTACK_AI_PERSONALITY, true, DT);
      expect(actions.held.has(Action.Dodge), intent).toBe(false);
    }
  });

  it('keeps holding Attack when launched mid-charge, so the charge is not dumped as an airborne Dash', () => {
    const selector = new ActionSelector();
    const actions = selector.selectActions(AiIntent.AirRecover, world({ ...launched, attackState: AttackState.ChargingDash, dashChargeFraction: 0.3 }), ATTACK_AI_PERSONALITY, false, DT);
    expect(actions.held.has(Action.Attack)).toBe(true);
    expect(actions.held.has(Action.Dodge)).toBe(true);
  });
});
