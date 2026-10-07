// ============================================================
// AI ARCHETYPE TRAITS — UNIT TESTS (MILESTONE 7 PART 2b)
// GDD section 64 tendencies added on top of M7 Part 2a's affinities
// (counterAffinity / punishAffinity / edgePressureAffinity, which already
// cover "uses counter opportunities" and "punishes commitment"):
// - Stamina: dodgeThrift ("preserves resources"), collisionAvoidance
//   ("avoids unnecessary heavy collisions"), fatigueExploitation
//   ("exploits fatigue");
// - Defense: centerControl ("uses wall/arena positioning").
// ============================================================

import { describe, expect, it } from 'vitest';
import { circleDirection } from '../../src/ai/decision/ActionSelection';
import { AiIntent } from '../../src/ai/decision/Intent';
import { NEUTRAL_DECISION_CONTEXT, selectIntent, type DecisionContext } from '../../src/ai/decision/IntentSelection';
import { evaluateRisk } from '../../src/ai/decision/RiskEvaluation';
import { buildWorldState, type WorldState } from '../../src/ai/decision/WorldState';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import type { AiPersonality } from '../../src/ai/personalities/AiPersonality';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY, STAMINA_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { dot, length } from '../../src/physics/Vec2';

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

function decide(w: WorldState, personality: AiPersonality, context: DecisionContext = NEUTRAL_DECISION_CONTEXT) {
  return selectIntent(w, personality, evaluateRisk(w, personality), context);
}

describe('dodgeThrift (Stamina: preserves resources)', () => {
  const farThreat = world({}, { positionXZ: { x: 0, z: 3.8 }, attackState: AttackState.DashActive });
  const pointBlank = world({}, { positionXZ: { x: 0, z: 1 }, attackState: AttackState.DashActive });

  it('Stamina sidesteps a threat that is not yet close, where Defense spends the Dodge', () => {
    expect(evaluateRisk(farThreat, STAMINA_AI_PERSONALITY).opponentThreat).toBeGreaterThanOrEqual(0.35);
    const stamina = decide(farThreat, STAMINA_AI_PERSONALITY);
    expect(stamina.intent).toBe(AiIntent.Circle);
    expect(stamina.reason).toContain('thrift');
    expect(decide(farThreat, DEFENSE_AI_PERSONALITY).intent).toBe(AiIntent.DodgeThreat);
  });

  it('everyone dodges point-blank', () => {
    for (const personality of [ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY, STAMINA_AI_PERSONALITY]) {
      expect(decide(pointBlank, personality).intent).toBe(AiIntent.DodgeThreat);
    }
  });

  it('is never thrifty in edge danger', () => {
    const onEdge = world({ positionXZ: { x: RINGOUT_RADIUS_M - 1.2, z: 0 } }, { positionXZ: { x: RINGOUT_RADIUS_M - 1.2, z: -3.8 }, attackState: AttackState.DashActive });
    const decision = decide(onEdge, STAMINA_AI_PERSONALITY);
    expect(decision.intent).toBe(AiIntent.DodgeThreat);
    expect(decision.edgeRecovery).toBe(true);
  });
});

describe('fatigueExploitation (Stamina: exploits fatigue)', () => {
  it('a tired opponent is an opening for Stamina far more than for Attack', () => {
    const fresh = world({}, { positionXZ: { x: 0, z: 3 }, staminaFraction: 0.9 });
    const tired = world({}, { positionXZ: { x: 0, z: 3 }, staminaFraction: 0.1 });
    const gain = (personality: AiPersonality) => evaluateRisk(tired, personality).opportunity - evaluateRisk(fresh, personality).opportunity;
    expect(evaluateRisk(fresh, STAMINA_AI_PERSONALITY).opportunity).toBe(0);
    expect(gain(STAMINA_AI_PERSONALITY)).toBeGreaterThan(0.4);
    expect(gain(STAMINA_AI_PERSONALITY)).toBeGreaterThan(3 * gain(ATTACK_AI_PERSONALITY));
  });
});

describe('collisionAvoidance (Stamina: avoids unnecessary heavy collisions)', () => {
  const dashScore = (w: WorldState, personality: AiPersonality, context: DecisionContext = NEUTRAL_DECISION_CONTEXT) => {
    // A candidate outside the kept top 3 is reported as 0.
    return decide(w, personality, context).consideredScores?.find((entry) => entry.intent === AiIntent.AttackDash)?.score ?? 0;
  };
  const avoidant = { ...STAMINA_AI_PERSONALITY, patience: 0.2 };
  const notAvoidant = { ...avoidant, collisionAvoidance: 0 };

  it('makes a Dash commitment far less attractive against an opponent that is not open', () => {
    const range = world({}, { positionXZ: { x: 0, z: 5 } });
    expect(dashScore(range, avoidant)).toBeLessThan(0.6 * dashScore(range, notAvoidant));
  });

  it('mostly disappears against an open opponent (Broken)', () => {
    const open = world({}, { positionXZ: { x: 0, z: 5 }, isBroken: true, stabilityFraction: 0.1 });
    expect(dashScore(open, avoidant)).toBeGreaterThan(0.9 * dashScore(open, notAvoidant));
  });

  it('wears off with the M7 Part 2a anti-passivity tempo — avoiding collisions never means never engaging', () => {
    const range = world({}, { positionXZ: { x: 0, z: 5 } });
    const late = { ...NEUTRAL_DECISION_CONTEXT, secondsSinceOwnAttack: 60 };
    expect(dashScore(range, avoidant, late)).toBeCloseTo(dashScore(range, notAvoidant, late), 6);
  });
});

describe('centerControl (Defense: uses arena positioning)', () => {
  it('Defense circles inward toward the center far more than Attack', () => {
    // Line to the opponent runs radially, so plain sideways circling is
    // tangential (no inward component at all).
    const outOnTheRing = world({ positionXZ: { x: RINGOUT_RADIUS_M - 2.9, z: 0 } }, { positionXZ: { x: RINGOUT_RADIUS_M - 6.9, z: 0 } });
    const inward = (personality: AiPersonality) => dot(circleDirection(outOnTheRing, personality, 1), outOnTheRing.own.directionTowardCenter);
    expect(length(circleDirection(outOnTheRing, DEFENSE_AI_PERSONALITY, 1))).toBeCloseTo(1, 5);
    expect(inward(DEFENSE_AI_PERSONALITY)).toBeGreaterThan(0.6);
    expect(inward(DEFENSE_AI_PERSONALITY)).toBeGreaterThan(inward(ATTACK_AI_PERSONALITY) + 0.4);
  });

  it('adds nothing at the center itself', () => {
    const middle = world({ positionXZ: { x: 0.01, z: 0 } }, { positionXZ: { x: 3, z: 3 } });
    const withPull = circleDirection(middle, DEFENSE_AI_PERSONALITY, 1);
    const withoutPull = circleDirection(middle, { ...DEFENSE_AI_PERSONALITY, centerControl: 0 }, 1);
    expect(withPull.x).toBeCloseTo(withoutPull.x, 3);
    expect(withPull.z).toBeCloseTo(withoutPull.z, 3);
  });
});
