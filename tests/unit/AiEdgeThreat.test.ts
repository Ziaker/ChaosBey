// ============================================================
// AI EDGE + THREAT — UNIT TESTS (MILESTONE 7 PART 2b)
// The combined case the M7 Part 2 review flagged as still open: high
// edge risk (>= the 0.55 recovery override) AND a live opponent hitbox
// closing in. Before Part 2b, selectIntent returned RecoverFromEdge
// before ever looking at the threat, so an AI on the edge walked straight
// into (or ignored) an incoming Dash. Now the hit is answered with an
// edge-safe evasion that is part of the recovery.
// ============================================================

import { describe, expect, it } from 'vitest';
import { ActionSelector, edgeRecoveryDirection, evasionDirection } from '../../src/ai/decision/ActionSelection';
import { AiIntent } from '../../src/ai/decision/Intent';
import { NEUTRAL_DECISION_CONTEXT, selectIntent, type DecisionContext } from '../../src/ai/decision/IntentSelection';
import { evaluateRisk } from '../../src/ai/decision/RiskEvaluation';
import { buildWorldState, type WorldState } from '../../src/ai/decision/WorldState';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { add, dot, fromYaw, normalize, perpendicular, scale, type Vec2 } from '../../src/physics/Vec2';

const DT = 1 / 60;
const PERSONALITY = DEFENSE_AI_PERSONALITY;
/** sin(22.5°): a Dodge quantized to the player's 8 directions can be off the ideal direction by up to half a 45° sector. */
const QUANTIZATION_SLACK = 0.383;

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
    momentum: 0,
    airRecoveryAvailable: false,
    canAffordDodge: true,
    ...overrides,
  };
}

function world(own: Partial<CombatantRawState>, opponent: Partial<CombatantRawState>): WorldState {
  return buildWorldState(0, perceiveCombatant(rawState(own)), perceiveCombatant(rawState(opponent)), { state: ClashState.Idle, cooldownRemainingS: 0 });
}

function decide(w: WorldState, context: DecisionContext = NEUTRAL_DECISION_CONTEXT) {
  return selectIntent(w, PERSONALITY, evaluateRisk(w, PERSONALITY), context);
}

/** The direction DodgeController.applyBurst sends a dodge for these held keys. */
function burstDirection(actions: ControllerActions, headingRad: number): Vec2 {
  const forward = fromYaw(headingRad);
  const right = perpendicular(forward);
  const lateral = (actions.held.has(Action.SteerRight) ? 1 : 0) - (actions.held.has(Action.SteerLeft) ? 1 : 0);
  const longitudinal = (actions.held.has(Action.MoveForward) ? 1 : 0) - (actions.held.has(Action.MoveBackward) ? 1 : 0);
  return lateral === 0 && longitudinal === 0 ? forward : normalize(add(scale(forward, longitudinal), scale(right, lateral)));
}

// AI on the +X edge; the dasher closes in along the ring (tangentially),
// from inside, or from the center side. Edge risk ~0.63 (x 1.3 caution).
const ON_EDGE = { x: RINGOUT_RADIUS_M - 1.3, z: 0 };
const dashFromTheSide = { positionXZ: { x: ON_EDGE.x - 0.5, z: -2 }, velocityXZ: { x: 0, z: 12 }, attackState: AttackState.DashActive };
const dashFromCenterSide = { positionXZ: { x: ON_EDGE.x - 2.2, z: 0 }, velocityXZ: { x: 12, z: 0 }, attackState: AttackState.DashActive };

describe('edge danger + live threat', () => {
  it('the scenario really is past the recovery override threshold, with a real threat', () => {
    const w = world({ positionXZ: ON_EDGE }, dashFromTheSide);
    const risk = evaluateRisk(w, PERSONALITY);
    expect(risk.edgeRisk).toBeGreaterThanOrEqual(0.55);
    expect(risk.opponentThreat).toBeGreaterThanOrEqual(0.35);
  });

  it('dodges (edge-safe) instead of ignoring the Dash to walk to the center', () => {
    const decision = decide(world({ positionXZ: ON_EDGE }, dashFromTheSide));
    expect(decision.intent).toBe(AiIntent.DodgeThreat);
    expect(decision.edgeRecovery).toBe(true);
    expect(decision.reason).toContain('edge-safe dodge');
  });

  it('aims the Dodge burst inward or tangential — never out of the ring, never into the attacker', () => {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, 2.4]) {
      for (const attacker of [dashFromTheSide, dashFromCenterSide]) {
        const w = world({ positionXZ: ON_EDGE, headingRad: heading }, attacker);
        const actions = new ActionSelector().selectActions(AiIntent.DodgeThreat, w, PERSONALITY, true, DT);
        expect(actions.pressedThisFrame.has(Action.Dodge)).toBe(true);
        const burst = burstDirection(actions, heading);
        const outward = scale(w.own.directionTowardCenter, -1);
        expect(dot(burst, outward), `heading ${heading}: burst leads out of the ring`).toBeLessThanOrEqual(QUANTIZATION_SLACK);
        expect(dot(burst, w.directionToOpponent), `heading ${heading}: burst leads into the attacker`).toBeLessThanOrEqual(QUANTIZATION_SLACK);
      }
    }
  });

  it('with Dodge on cooldown but a jump available, sidesteps on the ground — no hop at the edge', () => {
    const w = world({ positionXZ: ON_EDGE, dodgeState: DodgeState.Cooldown }, dashFromTheSide);
    const decision = decide(w);
    expect(decision.intent).toBe(AiIntent.DodgeThreat);
    expect(decision.reason).toContain('no hop at the edge');
    const actions = new ActionSelector().selectActions(decision.intent, w, PERSONALITY, true, DT);
    expect(actions.held.has(Action.JumpDrift)).toBe(false);
    expect(actions.held.has(Action.Dodge)).toBe(false);
  });

  it('with neither Dodge nor jump available, still sidesteps along the edge-safe line', () => {
    const w = world({ positionXZ: ON_EDGE, dodgeState: DodgeState.Cooldown, driftState: DriftState.Recovering, canAffordDodge: false }, dashFromTheSide);
    const decision = decide(w);
    expect(decision.intent).toBe(AiIntent.DodgeThreat);
    expect(decision.edgeRecovery).toBe(true);
    const escape = evasionDirection(w);
    expect(dot(escape, w.own.directionTowardCenter)).toBeGreaterThan(0.3);
    expect(dot(escape, w.directionToOpponent)).toBeLessThanOrEqual(1e-9);
  });

  it('with the attacker between it and the center: escapes tangentially, never toward the attacker', () => {
    const w = world({ positionXZ: ON_EDGE }, dashFromCenterSide);
    expect(dot(w.directionToOpponent, w.own.directionTowardCenter)).toBeGreaterThan(0.99);
    expect(decide(w).intent).toBe(AiIntent.DodgeThreat);
    const escape = evasionDirection(w);
    expect(dot(escape, w.directionToOpponent)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(dot(escape, w.own.directionTowardCenter))).toBeLessThan(1e-6);
  });

  it('stays grounded mid-dodge at the edge', () => {
    expect(decide(world({ positionXZ: ON_EDGE, dodgeState: DodgeState.Dodging }, dashFromTheSide)).intent).toBe(AiIntent.DodgeThreat);
  });

  it('resumes edge recovery as soon as the hit is over — even below the entry threshold (hysteresis kept through the evasion)', () => {
    const during = decide(world({ positionXZ: ON_EDGE }, dashFromTheSide));
    expect(during.edgeRecovery).toBe(true);
    // Dash over (opponent in recovery); own edge risk now between the
    // release (0.3) and entry (0.55) thresholds.
    const partlyIn = { x: RINGOUT_RADIUS_M - 2.2, z: 0 };
    const after = world({ positionXZ: partlyIn }, { positionXZ: { x: 4, z: 3 }, attackState: AttackState.DashRecovery });
    const risk = evaluateRisk(after, PERSONALITY);
    expect(risk.edgeRisk).toBeGreaterThan(0.3);
    expect(risk.edgeRisk).toBeLessThan(0.55);
    expect(decide(after, { ...NEUTRAL_DECISION_CONTEXT, recoveringFromEdge: during.edgeRecovery === true }).intent).toBe(AiIntent.RecoverFromEdge);
    // Without an ongoing recovery the same spot would not trigger it.
    expect(decide(after).intent).not.toBe(AiIntent.RecoverFromEdge);
  });

  it('a telegraph (ChargingDash) is not a live hit: recovery keeps priority, as approved in M7 Part 2a', () => {
    const w = world({ positionXZ: ON_EDGE }, { positionXZ: { x: ON_EDGE.x - 3, z: 0 }, attackState: AttackState.ChargingDash });
    expect(decide(w).intent).toBe(AiIntent.RecoverFromEdge);
  });
});

describe('edge recovery around a blocking opponent', () => {
  it('goes straight to the center when the way is clear', () => {
    const w = world({ positionXZ: ON_EDGE }, { positionXZ: { x: 0, z: -6 } });
    expect(edgeRecoveryDirection(w)).toEqual(w.own.directionTowardCenter);
  });

  it('goes around an opponent standing in the way instead of pushing into it against the wall', () => {
    const w = world({ positionXZ: ON_EDGE }, { positionXZ: { x: ON_EDGE.x - 1.4, z: 0.3 } });
    const direction = edgeRecoveryDirection(w);
    expect(dot(direction, w.own.directionTowardCenter)).toBeGreaterThan(0.3);
    expect(dot(direction, w.directionToOpponent)).toBeLessThan(dot(w.own.directionTowardCenter, w.directionToOpponent) - 0.4);
  });
});
