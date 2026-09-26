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
import { NEUTRAL_DECISION_CONTEXT, selectIntent, type DecisionContext } from '../../src/ai/decision/IntentSelection';
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
    dodgeReady: true,
    airRecoveryAvailable: false,
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
  it('reports up to 3 candidates, best first, with the winner on top', () => {
    const decision = decide({}, { positionXZ: { x: 0, z: 4.5 } }, DEFENSE_AI_PERSONALITY);
    const scores = decision.consideredScores ?? [];
    expect(scores.length).toBe(3);
    expect(scores[0]!.intent).toBe(decision.intent);
    expect(scores[0]!.score).toBeGreaterThanOrEqual(scores[1]!.score);
    expect(scores[1]!.score).toBeGreaterThanOrEqual(scores[2]!.score);
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
// M7 Part 2b — edge danger + immediate threat at once.
// Defense edgeCautionMultiplier 1.3: at z=11 raw edge risk ~0.46 -> ~0.59
// (over the 0.55 entry threshold). Opponent approaches from the center side.
// ============================================================

describe('selectIntent — edge-safe evasion (M7 Part 2b)', () => {
  const atEdge = { positionXZ: { x: 0, z: 11 } };
  const liveCircularFromCenter = { positionXZ: { x: 0, z: 9.5 }, attackState: AttackState.CircularActive };
  const noErrors = { ...DEFENSE_AI_PERSONALITY, errorRate: 0 };

  it('dodges when Dodge is ready, and marks the decision as part of the edge episode', () => {
    const decision = decide(atEdge, liveCircularFromCenter, noErrors);
    expect(decision.intent).toBe(AiIntent.DodgeThreat);
    expect(decision.edgeEpisode).toBe(true);
  });

  it('keeps DodgeThreat while already dodging instead of jumping out of its own i-frames', () => {
    expect(decide({ ...atEdge, dodgeState: DodgeState.Dodging, dodgeReady: false }, liveCircularFromCenter, noErrors).intent).toBe(AiIntent.DodgeThreat);
  });

  it('jumps (JumpEvade) when Dodge is on cooldown but a jump is available', () => {
    expect(decide({ ...atEdge, dodgeState: DodgeState.Cooldown, dodgeReady: false }, liveCircularFromCenter, noErrors).intent).toBe(AiIntent.JumpEvade);
  });

  it('treats Dodge as unavailable when Stamina is below its cost even though the state is Idle', () => {
    // Regression (source-semantics audit): Idle alone used to count as "can dodge".
    expect(decide({ ...atEdge, dodgeState: DodgeState.Idle, dodgeReady: false }, liveCircularFromCenter, noErrors).intent).toBe(AiIntent.JumpEvade);
  });

  it('falls back to the safest movement when neither Dodge nor a jump is available', () => {
    const decision = decide({ ...atEdge, dodgeState: DodgeState.Cooldown, dodgeReady: false, driftState: DriftState.Hopping }, liveCircularFromCenter, noErrors);
    expect(decision.intent).toBe(AiIntent.Retreat);
    expect(decision.edgeEpisode).toBe(true);
  });

  it('answers a telegraph (charging Dash) by recovering from the edge, not by spending an early dodge', () => {
    expect(decide(atEdge, { positionXZ: { x: 0, z: 6 }, attackState: AttackState.ChargingDash }, noErrors).intent).toBe(AiIntent.RecoverFromEdge);
  });

  it('counts an active Dash as immediate only once it can arrive within ~0.4 s', () => {
    const farDash = { positionXZ: { x: 0, z: 0 }, velocityXZ: { x: 0, z: 15 }, attackState: AttackState.DashActive };
    const nearDash = { positionXZ: { x: 0, z: 6 }, velocityXZ: { x: 0, z: 15 }, attackState: AttackState.DashActive };
    expect(decide(atEdge, farDash, noErrors).intent).toBe(AiIntent.RecoverFromEdge);
    expect(decide(atEdge, nearDash, noErrors).intent).toBe(AiIntent.DodgeThreat);
  });

  it('resumes edge recovery once the threat is gone, inside the hysteresis band (no evade/recover flip-flop)', () => {
    // z=10.6: weighted edge risk ~0.45 — below the 0.55 entry threshold, above the 0.30 release.
    const stillNearEdge = { positionXZ: { x: 0, z: 10.6 } };
    const threatGone = { positionXZ: { x: 0, z: 7 }, attackState: AttackState.DashRecovery };
    expect(decide(stillNearEdge, threatGone, noErrors, { ...NEUTRAL_DECISION_CONTEXT, recoveringFromEdge: true }).intent).toBe(AiIntent.RecoverFromEdge);
  });

  it('marks edge-episode decisions critical at critical edge risk, so deliberate errors can never touch them', () => {
    const almostOut = { positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 0.3 } };
    expect(decide(almostOut, liveCircularFromCenter, noErrors).critical).toBe(true);
    expect(decide(atEdge, liveCircularFromCenter, noErrors).critical).toBe(false);
  });
});
