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
import { clashWillingness, NEUTRAL_DECISION_CONTEXT, selectIntent, type DecisionContext } from '../../src/ai/decision/IntentSelection';
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
    airRecoveryAvailable: false,
    canAffordDodge: true,
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

// ============================================================
// M7 Part 2 — counter read, punish windows, edge pressure, tempo,
// considered scores.
// ============================================================

function decide(own: Partial<CombatantRawState>, opponent: Partial<CombatantRawState>, personality = DEFENSE_AI_PERSONALITY, context: DecisionContext = NEUTRAL_DECISION_CONTEXT) {
  const w = world(own, opponent);
  return selectIntent(w, personality, evaluateRisk(w, personality), context);
}

describe('selectIntent — Circular counter read (M7 Part 2)', () => {
  const telegraph = { positionXZ: { x: 0, z: 5 }, attackState: AttackState.ChargingDash };

  it('holds a CounterAttack stance against a telegraphed Dash when this Dash was rolled for a counter', () => {
    expect(decide({}, telegraph, DEFENSE_AI_PERSONALITY, { ...NEUTRAL_DECISION_CONTEXT, counterDash: true }).intent).toBe(AiIntent.CounterAttack);
  });

  it('does not counter when the roll said no', () => {
    expect(decide({}, telegraph, DEFENSE_AI_PERSONALITY, NEUTRAL_DECISION_CONTEXT).intent).not.toBe(AiIntent.CounterAttack);
  });

  it('does not counter while already mid-attack, or against a Circular', () => {
    expect(decide({ attackState: AttackState.ChargingDash }, telegraph, DEFENSE_AI_PERSONALITY, { ...NEUTRAL_DECISION_CONTEXT, counterDash: true }).intent).not.toBe(
      AiIntent.CounterAttack,
    );
    expect(
      decide({}, { positionXZ: { x: 0, z: 1.5 }, attackState: AttackState.CircularActive }, DEFENSE_AI_PERSONALITY, { ...NEUTRAL_DECISION_CONTEXT, counterDash: true }).intent,
    ).not.toBe(AiIntent.CounterAttack);
  });

  it('edge danger still outranks a counter read', () => {
    const nearEdge = { positionXZ: { x: RINGOUT_RADIUS_M - 0.5, z: 0 } };
    expect(
      decide(nearEdge, { positionXZ: { x: RINGOUT_RADIUS_M - 4, z: 0 }, attackState: AttackState.ChargingDash }, DEFENSE_AI_PERSONALITY, {
        ...NEUTRAL_DECISION_CONTEXT,
        counterDash: true,
      }).intent,
    ).toBe(AiIntent.RecoverFromEdge);
  });
});

describe('selectIntent — punish windows (M7 Part 2)', () => {
  it('Defense punishes a whiffed Dash in Dash range that it would otherwise just circle', () => {
    const inDashRange = { positionXZ: { x: 0, z: 4.5 } };
    expect(decide({}, inDashRange, DEFENSE_AI_PERSONALITY).intent).toBe(AiIntent.Circle);
    expect(decide({}, { ...inDashRange, attackState: AttackState.DashRecovery }, DEFENSE_AI_PERSONALITY).intent).toBe(AiIntent.AttackDash);
  });
});

describe('selectIntent — edge pressure (M7 Part 2)', () => {
  it('Attack presses an opponent at the edge instead of a plain attack', () => {
    const own = { positionXZ: { x: RINGOUT_RADIUS_M - 2.4, z: 0 } };
    const middle = { positionXZ: { x: 1.5, z: 0 } };
    const atEdge = { positionXZ: { x: RINGOUT_RADIUS_M - 0.4, z: 0 } };
    expect(decide({}, middle, ATTACK_AI_PERSONALITY).intent).toBe(AiIntent.AttackCircular);
    expect(decide(own, atEdge, ATTACK_AI_PERSONALITY).intent).toBe(AiIntent.PressAdvantage);
  });
});

describe('selectIntent — anti-passivity tempo (M7 Part 2)', () => {
  it('a patient personality circles at first but engages after a long stretch without attacking', () => {
    const inDashRange = { positionXZ: { x: 0, z: 4.5 } };
    expect(decide({}, inDashRange, STAMINA_AI_PERSONALITY, NEUTRAL_DECISION_CONTEXT).intent).toBe(AiIntent.Circle);
    const later = decide({}, inDashRange, STAMINA_AI_PERSONALITY, { ...NEUTRAL_DECISION_CONTEXT, secondsSinceOwnAttack: 20 }).intent;
    expect([AiIntent.Circle, AiIntent.Wait]).not.toContain(later);
  });
});

describe('selectIntent — considered scores (M7 Part 2, GDD section 65)', () => {
  it('reports every scored candidate, best first, with the winner on top (M7 Part 2b: all, not just the top 3)', () => {
    const decision = decide({}, { positionXZ: { x: 0, z: 4.5 } }, DEFENSE_AI_PERSONALITY);
    const scores = decision.consideredScores ?? [];
    expect(scores.length).toBe(8);
    expect(new Set(scores.map((entry) => entry.intent)).size).toBe(scores.length);
    expect(scores[0]!.intent).toBe(decision.intent);
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]!.score).toBeGreaterThanOrEqual(scores[i]!.score);
  });

  it('reports no scores when an override decided', () => {
    const decision = decide({ positionXZ: { x: RINGOUT_RADIUS_M - 0.3, z: 0 } }, { positionXZ: { x: 0, z: 0 } });
    expect(decision.intent).toBe(AiIntent.RecoverFromEdge);
    expect(decision.consideredScores ?? []).toHaveLength(0);
  });
});

describe('selectIntent — edge recovery hysteresis (M7 Part 2)', () => {
  // Defense edgeCautionMultiplier 1.3: at z=10.2 raw edge risk ~0.23 -> weighted ~0.30; at z=10.9 ~0.43 -> ~0.56.
  const opponentFarAway = { positionXZ: { x: 0, z: -6 } };

  it('keeps recovering below the entry threshold once already recovering, and releases once well clear', () => {
    const between = { positionXZ: { x: 0, z: 10.6 } };
    expect(decide(between, opponentFarAway, DEFENSE_AI_PERSONALITY).intent).not.toBe(AiIntent.RecoverFromEdge);
    expect(decide(between, opponentFarAway, DEFENSE_AI_PERSONALITY, { ...NEUTRAL_DECISION_CONTEXT, recoveringFromEdge: true }).intent).toBe(
      AiIntent.RecoverFromEdge,
    );
    const clear = { positionXZ: { x: 0, z: 9 } };
    expect(decide(clear, opponentFarAway, DEFENSE_AI_PERSONALITY, { ...NEUTRAL_DECISION_CONTEXT, recoveringFromEdge: true }).intent).not.toBe(
      AiIntent.RecoverFromEdge,
    );
  });
});

// ============================================================
// Clash willingness (ported from PR #15): GDD section 42/63 — the AI can
// create/accept Clash opportunities, by personality, only when a Clash can
// actually start.
// ============================================================

describe('clashWillingness (M7 Part 2b, ported from PR #15)', () => {
  const opponentCharging = { positionXZ: { x: 0, z: 6 }, attackState: AttackState.ChargingDash };
  const withClash = (w: WorldState, state: ClashState): WorldState => ({ ...w, clash: { state, cooldownRemainingS: state === ClashState.Cooldown ? 2 : 0 } });
  const scoreOf = (decision: ReturnType<typeof selectIntent>, intent: AiIntent) => decision.consideredScores?.find((entry) => entry.intent === intent)?.score;

  it('is 1 (attack as usual) when the opponent has no live/imminent hitbox', () => {
    expect(clashWillingness(world({}, { positionXZ: { x: 0, z: 6 } }), DEFENSE_AI_PERSONALITY)).toBe(1);
    expect(clashWillingness(world({}, { positionXZ: { x: 0, z: 6 }, attackState: AttackState.DashRecovery }), DEFENSE_AI_PERSONALITY)).toBe(1);
  });

  it('is 1 when a Clash cannot start (Cooldown or already Active) — nothing to accept', () => {
    const w = world({}, opponentCharging);
    expect(clashWillingness(withClash(w, ClashState.Cooldown), DEFENSE_AI_PERSONALITY)).toBe(1);
    expect(clashWillingness(withClash(w, ClashState.Active), DEFENSE_AI_PERSONALITY)).toBe(1);
    expect(clashWillingness(withClash(w, ClashState.Idle), DEFENSE_AI_PERSONALITY)).toBeLessThan(1);
  });

  it('keeps archetype differences (aggression leans in, caution away) and stays within 0..1', () => {
    const w = world({}, opponentCharging);
    const attack = clashWillingness(w, ATTACK_AI_PERSONALITY);
    const stamina = clashWillingness(w, STAMINA_AI_PERSONALITY);
    const defense = clashWillingness(w, DEFENSE_AI_PERSONALITY);
    expect(attack).toBeGreaterThan(stamina);
    expect(stamina).toBeGreaterThan(defense);
    for (const value of [attack, stamina, defense]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('leans in with a Stamina edge (Clash power scales with ClashFormula\'s StaminaFactor) — both bars are visible', () => {
    const ahead = clashWillingness(world({ staminaFraction: 1 }, { ...opponentCharging, staminaFraction: 0.2 }), DEFENSE_AI_PERSONALITY);
    const behind = clashWillingness(world({ staminaFraction: 0.2 }, { ...opponentCharging, staminaFraction: 1 }), DEFENSE_AI_PERSONALITY);
    expect(ahead).toBeGreaterThan(behind);
  });

  it('scales exactly the attack candidates in real scoring: Idle vs Cooldown differ only by the multiplier', () => {
    const base = world({}, opponentCharging);
    const idle = selectIntent(withClash(base, ClashState.Idle), DEFENSE_AI_PERSONALITY, evaluateRisk(base, DEFENSE_AI_PERSONALITY));
    const cooldown = selectIntent(withClash(base, ClashState.Cooldown), DEFENSE_AI_PERSONALITY, evaluateRisk(base, DEFENSE_AI_PERSONALITY));
    expect(cooldown.clashWillingness).toBe(1);
    expect(idle.clashWillingness).toBeLessThan(1);
    expect(scoreOf(idle, AiIntent.AttackDash)!).toBeCloseTo(scoreOf(cooldown, AiIntent.AttackDash)! * idle.clashWillingness!, 12);
    for (const unaffected of [AiIntent.Approach, AiIntent.Circle, AiIntent.Retreat, AiIntent.Wait]) {
      expect(scoreOf(idle, unaffected), unaffected).toBe(scoreOf(cooldown, unaffected));
    }
  });

  it('can change the choice, but only while a Clash could start: a cautious attacker declines the exchange when Idle, takes it on Cooldown', () => {
    const cautiousAttacker = { ...ATTACK_AI_PERSONALITY, caution: 0.9 };
    const base = world({}, opponentCharging);
    const risk = evaluateRisk(base, cautiousAttacker);
    expect(selectIntent(withClash(base, ClashState.Cooldown), cautiousAttacker, risk).intent).toBe(AiIntent.AttackDash);
    expect(selectIntent(withClash(base, ClashState.Idle), cautiousAttacker, risk).intent).not.toBe(AiIntent.AttackDash);
    // A willing attacker takes it either way — a multiplier, not a rule.
    expect(selectIntent(withClash(base, ClashState.Idle), ATTACK_AI_PERSONALITY, evaluateRisk(base, ATTACK_AI_PERSONALITY)).intent).toBe(AiIntent.AttackDash);
  });

  it('does not touch hard overrides: an imminent threat inside the override range is still answered, whatever the willingness', () => {
    const close = world({}, { positionXZ: { x: 0, z: 2 }, attackState: AttackState.CircularActive });
    const decision = selectIntent(close, ATTACK_AI_PERSONALITY, evaluateRisk(close, ATTACK_AI_PERSONALITY));
    expect(decision.consideredScores ?? []).toEqual([]);
    expect(decision.clashWillingness).toBeUndefined();
  });
});
