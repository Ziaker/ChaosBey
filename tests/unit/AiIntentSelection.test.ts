// ============================================================
// AI INTENT SELECTION — UNIT TESTS (MILESTONE 7)
// GDD section 62/65: selectIntent must be a pure function of its inputs
// (no RNG), and the two hard overrides (edge danger, imminent threat) must
// win over normal scoring regardless of personality.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { buildWorldState, type WorldState } from '../../src/ai/decision/WorldState';
import { evaluateRisk } from '../../src/ai/decision/RiskEvaluation';
import { selectIntent } from '../../src/ai/decision/IntentSelection';
import { AiIntent } from '../../src/ai/decision/Intent';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY, STAMINA_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';

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

function world(ownOverrides: Partial<CombatantRawState>, opponentOverrides: Partial<CombatantRawState>): WorldState {
  const own = perceiveCombatant(rawState(ownOverrides));
  const opponent = perceiveCombatant(rawState(opponentOverrides));
  return buildWorldState(0, own, opponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
}

describe('selectIntent', () => {
  it('is deterministic: identical inputs always produce identical output', () => {
    const w = world({ positionXZ: { x: 0, z: 0 } }, { positionXZ: { x: 3, z: 0 } });
    const risk = evaluateRisk(w, ATTACK_AI_PERSONALITY);
    const a = selectIntent(w, ATTACK_AI_PERSONALITY, risk);
    const b = selectIntent(w, ATTACK_AI_PERSONALITY, risk);
    expect(a.intent).toBe(b.intent);
    expect(a.reason).toBe(b.reason);
  });

  it('overrides everything with RecoverFromEdge when edge risk is high, for every archetype', () => {
    const w = world({ positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 0.2 } }, { positionXZ: { x: 0, z: 0 } });
    for (const personality of [ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY, STAMINA_AI_PERSONALITY]) {
      const risk = evaluateRisk(w, personality);
      expect(selectIntent(w, personality, risk).intent).toBe(AiIntent.RecoverFromEdge);
    }
  });

  it('overrides normal scoring with DodgeThreat when the opponent has an imminent close-range hitbox', () => {
    const w = world({ positionXZ: { x: 0, z: 0 } }, { positionXZ: { x: 1, z: 0 }, attackState: AttackState.DashActive });
    const risk = evaluateRisk(w, DEFENSE_AI_PERSONALITY);
    expect(selectIntent(w, DEFENSE_AI_PERSONALITY, risk).intent).toBe(AiIntent.DodgeThreat);
  });

  it('falls back to UseJumpDrift when threatened and Dodge is on cooldown but jump is available (regression for the M7 part 1 review)', () => {
    const w = world(
      { positionXZ: { x: 0, z: 0 }, dodgeState: DodgeState.Cooldown, driftState: DriftState.Idle, grounded: true },
      { positionXZ: { x: 1, z: 0 }, attackState: AttackState.DashActive },
    );
    const risk = evaluateRisk(w, DEFENSE_AI_PERSONALITY);
    expect(selectIntent(w, DEFENSE_AI_PERSONALITY, risk).intent).toBe(AiIntent.UseJumpDrift);
  });

  it('falls back to Retreat when threatened and both Dodge and jump are unavailable (regression for the M7 part 1 review)', () => {
    const w = world(
      { positionXZ: { x: 0, z: 0 }, dodgeState: DodgeState.Cooldown, driftState: DriftState.Idle, grounded: false },
      { positionXZ: { x: 1, z: 0 }, attackState: AttackState.DashActive },
    );
    const risk = evaluateRisk(w, DEFENSE_AI_PERSONALITY);
    expect(selectIntent(w, DEFENSE_AI_PERSONALITY, risk).intent).toBe(AiIntent.Retreat);
  });

  it('never selects an attack intent while already mid-attack', () => {
    const w = world({ positionXZ: { x: 0, z: 0 }, attackState: AttackState.ChargingDash }, { positionXZ: { x: 1, z: 0 } });
    const risk = evaluateRisk(w, ATTACK_AI_PERSONALITY);
    const intent = selectIntent(w, ATTACK_AI_PERSONALITY, risk).intent;
    expect(intent).not.toBe(AiIntent.AttackCircular);
    expect(intent).not.toBe(AiIntent.AttackDash);
  });

  it('Attack personality never turns passive against a Broken opponent it can reach, unlike a purely defensive read', () => {
    const w = world({ positionXZ: { x: 0, z: 0 } }, { positionXZ: { x: 2, z: 0 }, isBroken: true, stabilityFraction: 0 });
    const attackRisk = evaluateRisk(w, ATTACK_AI_PERSONALITY);
    const attackIntent = selectIntent(w, ATTACK_AI_PERSONALITY, attackRisk).intent;
    // Attack's aggression should never land on the passive Retreat/Wait set
    // here while an opening this large (a reachable Broken opponent) is
    // available — pressing the advantage is GDD section 64's explicit
    // Attack-archetype tendency.
    expect([AiIntent.Retreat, AiIntent.Wait]).not.toContain(attackIntent);
  });
});
