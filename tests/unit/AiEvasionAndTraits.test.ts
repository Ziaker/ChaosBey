// ============================================================
// AI EVASION, PERCEPTION FIXES AND ARCHETYPE TRAITS — UNIT TESTS (M7 PART 2)
// Covers the fixes from the M7 part 2 audit (stale Dash charge, evasion
// direction, dodge press gating, edge-aware hops, momentum edge risk) and
// the archetype traits that make Defense and Stamina behave differently
// (GDD section 64: counters/center for Defense; resource thrift, collision
// avoidance, fatigue exploitation for Stamina).
// ============================================================

import { describe, expect, it } from 'vitest';
import { ActionSelector, circleDirection, dodgeDirectionKeys, evasionDirection, retreatDirection } from '../../src/ai/decision/ActionSelection';
import { AiIntent } from '../../src/ai/decision/Intent';
import { selectIntent } from '../../src/ai/decision/IntentSelection';
import { evaluateRisk } from '../../src/ai/decision/RiskEvaluation';
import { buildWorldState, type WorldState } from '../../src/ai/decision/WorldState';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY, STAMINA_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { Action } from '../../src/input/actions/Action';
import { dot, fromYaw, length, perpendicular } from '../../src/physics/Vec2';

const DT = 1 / 60;

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
    airRecoveryAvailable: false,
    canAffordDodge: true,
    ...overrides,
  };
}

function world(ownOverrides: Partial<CombatantRawState>, opponentOverrides: Partial<CombatantRawState>, secondsSinceEngagement = 0): WorldState {
  return buildWorldState(
    0,
    perceiveCombatant(rawState(ownOverrides)),
    perceiveCombatant(rawState(opponentOverrides)),
    { state: ClashState.Idle, cooldownRemainingS: 0 },
    undefined,
    secondsSinceEngagement,
  );
}

describe('perception fixes', () => {
  it('ignores the stale Dash charge AttackController keeps reporting after a Dash ended', () => {
    // Regression: the stale 0.52 read as "already charged" and the AI never
    // pressed Attack again after its first Dash.
    expect(perceiveCombatant(rawState({ attackState: AttackState.Neutral, dashChargeFraction: 0.52 })).dashChargeFraction).toBe(0);
    expect(perceiveCombatant(rawState({ attackState: AttackState.DashRecovery, dashChargeFraction: 0.52 })).dashChargeFraction).toBe(0);
    expect(perceiveCombatant(rawState({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.3 })).dashChargeFraction).toBe(0.3);
  });

  it('projects edge risk along the Bey\'s own momentum', () => {
    const still = perceiveCombatant(rawState({ positionXZ: { x: 0, z: 8 } }));
    const flyingOut = perceiveCombatant(rawState({ positionXZ: { x: 0, z: 8 }, velocityXZ: { x: 0, z: 12 } }));
    expect(still.edgeRiskFraction).toBe(0);
    expect(still.projectedEdgeRiskFraction).toBe(0);
    expect(flyingOut.edgeRiskFraction).toBe(0);
    expect(flyingOut.projectedEdgeRiskFraction).toBeGreaterThan(0.9);
    // RiskEvaluation uses whichever is worse.
    const w = world({ positionXZ: { x: 0, z: 8 }, velocityXZ: { x: 0, z: 12 } }, { positionXZ: { x: 0, z: 0 } });
    expect(evaluateRisk(w, ATTACK_AI_PERSONALITY).edgeRisk).toBeGreaterThan(0.9);
    expect(selectIntent(w, ATTACK_AI_PERSONALITY, evaluateRisk(w, ATTACK_AI_PERSONALITY)).intent).toBe(AiIntent.RecoverFromEdge);
  });
});

describe('evasion geometry', () => {
  it('evades sideways off the attack line, on the side facing the center', () => {
    // Own Bey out toward +X, attacker further out... line runs along Z.
    const w = world({ positionXZ: { x: 5, z: 0 } }, { positionXZ: { x: 5, z: 4 } });
    const direction = evasionDirection(w);
    expect(Math.abs(dot(direction, w.directionToOpponent))).toBeLessThan(1e-9);
    expect(dot(direction, w.own.directionTowardCenter)).toBeGreaterThan(0.99);
  });

  it('retreats straight away in open space but bends toward the center near the edge', () => {
    const open = world({ positionXZ: { x: 0, z: 0 } }, { positionXZ: { x: 0, z: -3 } });
    expect(retreatDirection(open).z).toBeCloseTo(1, 5);
    // Near the +Z edge with the attacker toward the center: straight away
    // would be straight out of the ring.
    const edge = world({ positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 1 } }, { positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 4 } });
    expect(dot(retreatDirection(edge), edge.own.directionTowardCenter)).toBeGreaterThan(0);
  });

  it('maps a Dodge direction onto the same 8 key combinations a player can press', () => {
    const heading = 0; // facing +Z, right = +X
    const forward = fromYaw(heading);
    const right = perpendicular(forward);
    expect(dodgeDirectionKeys(heading, forward)).toEqual([Action.MoveForward]);
    expect(dodgeDirectionKeys(heading, { x: -forward.x, z: -forward.z })).toEqual([Action.MoveBackward]);
    expect(dodgeDirectionKeys(heading, right)).toEqual([Action.SteerRight]);
    expect(dodgeDirectionKeys(heading, { x: -right.x, z: -right.z })).toEqual([Action.SteerLeft]);
    const diagonal = { x: (forward.x + right.x) / Math.SQRT2, z: (forward.z + right.z) / Math.SQRT2 };
    expect(dodgeDirectionKeys(heading, diagonal)).toEqual([Action.MoveForward, Action.SteerRight]);
  });

  it('aims the Dodge burst sideways instead of along the attack line', () => {
    // Facing the attacker head-on (heading 0 = +Z toward the opponent):
    // the dodge must go left/right, never forward into the Dash.
    const w = world({ positionXZ: { x: 0, z: 0 }, headingRad: 0 }, { positionXZ: { x: 0, z: 2 }, attackState: AttackState.DashActive });
    const actions = new ActionSelector().selectActions(AiIntent.DodgeThreat, w, DEFENSE_AI_PERSONALITY, true, DT);
    expect(actions.pressedThisFrame.has(Action.Dodge)).toBe(true);
    expect(actions.held.has(Action.MoveForward)).toBe(false);
    expect(actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight)).toBe(true);
  });
});

describe('dodge press gating', () => {
  const threat = { positionXZ: { x: 0, z: 2 }, attackState: AttackState.DashActive };

  it('does not waste the press while airborne, and presses on landing', () => {
    const selector = new ActionSelector();
    const airborne = selector.selectActions(AiIntent.DodgeThreat, world({ grounded: false }, threat), DEFENSE_AI_PERSONALITY, true, DT);
    expect(airborne.held.has(Action.Dodge)).toBe(false);
    const landed = selector.selectActions(AiIntent.DodgeThreat, world({ grounded: true }, threat), DEFENSE_AI_PERSONALITY, true, DT);
    expect(landed.pressedThisFrame.has(Action.Dodge)).toBe(true);
  });

  it('never holds Dodge across ticks — a retry is always a fresh press', () => {
    const selector = new ActionSelector();
    const w = world({}, threat);
    const first = selector.selectActions(AiIntent.DodgeThreat, w, DEFENSE_AI_PERSONALITY, true, DT);
    const second = selector.selectActions(AiIntent.DodgeThreat, w, DEFENSE_AI_PERSONALITY, true, DT);
    const third = selector.selectActions(AiIntent.DodgeThreat, w, DEFENSE_AI_PERSONALITY, true, DT);
    expect(first.pressedThisFrame.has(Action.Dodge)).toBe(true);
    expect(second.held.has(Action.Dodge)).toBe(false);
    expect(third.pressedThisFrame.has(Action.Dodge)).toBe(true);
  });

  it('does not press Dodge it cannot pay for, and does not pick DodgeThreat then', () => {
    const w = world({ canAffordDodge: false }, threat);
    const actions = new ActionSelector().selectActions(AiIntent.DodgeThreat, w, DEFENSE_AI_PERSONALITY, true, DT);
    expect(actions.held.has(Action.Dodge)).toBe(false);
    const decision = selectIntent(w, DEFENSE_AI_PERSONALITY, evaluateRisk(w, DEFENSE_AI_PERSONALITY));
    expect(decision.intent).not.toBe(AiIntent.DodgeThreat);
    expect(decision.reason).toContain('not enough Stamina');
  });

  it('stays grounded mid-dodge instead of hopping away from its own i-frames', () => {
    const w = world({ dodgeState: DodgeState.Dodging }, threat);
    expect(selectIntent(w, DEFENSE_AI_PERSONALITY, evaluateRisk(w, DEFENSE_AI_PERSONALITY)).intent).toBe(AiIntent.DodgeThreat);
  });

  it('does not answer a threat with a hop near the edge', () => {
    const nearEdge = world(
      { positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 2.2 }, dodgeState: DodgeState.Cooldown },
      { positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 4 }, attackState: AttackState.DashActive },
    );
    const risk = evaluateRisk(nearEdge, ATTACK_AI_PERSONALITY);
    expect(risk.edgeRisk).toBeGreaterThanOrEqual(0.3);
    expect(risk.edgeRisk).toBeLessThan(0.55);
    expect(selectIntent(nearEdge, ATTACK_AI_PERSONALITY, risk).intent).toBe(AiIntent.Retreat);

    const center = world({ positionXZ: { x: 0, z: 0 }, dodgeState: DodgeState.Cooldown }, { positionXZ: { x: 0, z: 2 }, attackState: AttackState.DashActive });
    expect(selectIntent(center, ATTACK_AI_PERSONALITY, evaluateRisk(center, ATTACK_AI_PERSONALITY)).intent).toBe(AiIntent.UseJumpDrift);
  });
});

describe('archetype traits (GDD section 64)', () => {
  it('Stamina sidesteps a threat that is not yet close instead of spending a Dodge; everyone dodges point-blank', () => {
    const farThreat = world({}, { positionXZ: { x: 0, z: 3.8 }, attackState: AttackState.DashActive });
    const staminaRisk = evaluateRisk(farThreat, STAMINA_AI_PERSONALITY);
    expect(staminaRisk.opponentThreat).toBeGreaterThanOrEqual(0.35);
    expect(selectIntent(farThreat, STAMINA_AI_PERSONALITY, staminaRisk).intent).toBe(AiIntent.Circle);
    expect(selectIntent(farThreat, DEFENSE_AI_PERSONALITY, evaluateRisk(farThreat, DEFENSE_AI_PERSONALITY)).intent).toBe(AiIntent.DodgeThreat);

    const pointBlank = world({}, { positionXZ: { x: 0, z: 1 }, attackState: AttackState.DashActive });
    for (const personality of [ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY, STAMINA_AI_PERSONALITY]) {
      expect(selectIntent(pointBlank, personality, evaluateRisk(pointBlank, personality)).intent).toBe(AiIntent.DodgeThreat);
    }
  });

  it('Defense values a committed whiff more than Attack does (punishes commitment)', () => {
    const whiff = world({}, { positionXZ: { x: 0, z: 2 }, attackState: AttackState.DashRecovery });
    expect(evaluateRisk(whiff, DEFENSE_AI_PERSONALITY).opportunity).toBeGreaterThan(evaluateRisk(whiff, ATTACK_AI_PERSONALITY).opportunity + 0.2);
  });

  it('Stamina reads a tired opponent as an opening far more than Attack does (exploits fatigue)', () => {
    const fresh = world({}, { positionXZ: { x: 0, z: 3 }, staminaFraction: 0.9 });
    const tired = world({}, { positionXZ: { x: 0, z: 3 }, staminaFraction: 0.1 });
    const staminaGain = evaluateRisk(tired, STAMINA_AI_PERSONALITY).opportunity - evaluateRisk(fresh, STAMINA_AI_PERSONALITY).opportunity;
    const attackGain = evaluateRisk(tired, ATTACK_AI_PERSONALITY).opportunity - evaluateRisk(fresh, ATTACK_AI_PERSONALITY).opportunity;
    expect(evaluateRisk(fresh, STAMINA_AI_PERSONALITY).opportunity).toBe(0);
    expect(staminaGain).toBeGreaterThan(0.4);
    expect(staminaGain).toBeGreaterThan(attackGain * 3);
  });

  it('collision avoidance lowers the appeal of a Dash commitment unless the opponent is open', () => {
    const range = world({}, { positionXZ: { x: 0, z: 5 } });
    const score = (personality: typeof STAMINA_AI_PERSONALITY, w: WorldState) =>
      selectIntent(w, personality, evaluateRisk(w, personality)).scores!.find((entry) => entry.intent === AiIntent.AttackDash)!.score;
    const avoidant = STAMINA_AI_PERSONALITY;
    const notAvoidant = { ...STAMINA_AI_PERSONALITY, collisionAvoidance: 0 };
    expect(score(avoidant, range)).toBeLessThan(score(notAvoidant, range) * 0.6);
    // Against a Broken opponent the reluctance mostly disappears.
    const open = world({}, { positionXZ: { x: 0, z: 5 }, isBroken: true, stabilityFraction: 0.1 });
    expect(score(avoidant, open)).toBeGreaterThan(score(notAvoidant, open) * 0.9);
  });

  it('Defense circles inward toward the center far more than Attack does', () => {
    // The line to the opponent runs radially, so plain sideways circling
    // is tangential (no inward component at all).
    const outOnTheRing = world({ positionXZ: { x: 10, z: 0 } }, { positionXZ: { x: 6, z: 0 } });
    expect(dot(evasionDirection(outOnTheRing), outOnTheRing.own.directionTowardCenter)).toBeCloseTo(0, 5);
    const inward = (personality: typeof DEFENSE_AI_PERSONALITY) => dot(circleDirection(outOnTheRing, personality), outOnTheRing.own.directionTowardCenter);
    expect(length(circleDirection(outOnTheRing, DEFENSE_AI_PERSONALITY))).toBeCloseTo(1, 5);
    expect(inward(DEFENSE_AI_PERSONALITY)).toBeGreaterThan(0.6);
    expect(inward(DEFENSE_AI_PERSONALITY)).toBeGreaterThan(inward(ATTACK_AI_PERSONALITY) + 0.4);
  });

  it('exposes every candidate score, best first, whenever it scored', () => {
    const w = world({}, { positionXZ: { x: 0, z: 4 } });
    const decision = selectIntent(w, DEFENSE_AI_PERSONALITY, evaluateRisk(w, DEFENSE_AI_PERSONALITY));
    expect(decision.scores!.length).toBeGreaterThan(5);
    expect(decision.scores![0]!.intent).toBe(decision.intent);
    for (let i = 1; i < decision.scores!.length; i++) expect(decision.scores![i - 1]!.score).toBeGreaterThanOrEqual(decision.scores![i]!.score);
    // Hard overrides are not scored.
    const threat = world({}, { positionXZ: { x: 0, z: 1 }, attackState: AttackState.DashActive });
    expect(selectIntent(threat, DEFENSE_AI_PERSONALITY, evaluateRisk(threat, DEFENSE_AI_PERSONALITY)).scores).toBeUndefined();
  });

  it('standoff impatience: after a long stretch with nobody attacking, a cautious AI stops circling and commits', () => {
    // Defense at its preferred range: circles while the fight is fresh...
    const fresh = world({}, { positionXZ: { x: 0, z: 4.5 } }, 0);
    expect(selectIntent(fresh, DEFENSE_AI_PERSONALITY, evaluateRisk(fresh, DEFENSE_AI_PERSONALITY)).intent).toBe(AiIntent.Circle);
    // ...still circles a few seconds in (impatience has not started)...
    const brief = world({}, { positionXZ: { x: 0, z: 4.5 } }, 3);
    expect(selectIntent(brief, DEFENSE_AI_PERSONALITY, evaluateRisk(brief, DEFENSE_AI_PERSONALITY)).intent).toBe(AiIntent.Circle);
    // ...and goes on the offensive after a long standoff.
    const standoff = world({}, { positionXZ: { x: 0, z: 4.5 } }, 12);
    expect([AiIntent.AttackDash, AiIntent.Approach, AiIntent.AttackCircular]).toContain(
      selectIntent(standoff, DEFENSE_AI_PERSONALITY, evaluateRisk(standoff, DEFENSE_AI_PERSONALITY)).intent,
    );
  });
});
