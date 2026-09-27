// ============================================================
// AI INTENTIONAL ERROR — UNIT TESTS (MILESTONE 7)
// GDD section 63/65: deliberate errors only ever downgrade to a safe,
// passive intent, and must never suppress a genuinely critical edge
// recovery (the AI must still "attempt recovery" — section 129).
// ============================================================

import { describe, expect, it } from 'vitest';
import { SeededRng } from '../../src/rng/SeededRng';
import { AiIntent } from '../../src/ai/decision/Intent';
import type { IntentDecision } from '../../src/ai/decision/IntentSelection';
import type { RiskAssessment } from '../../src/ai/decision/RiskEvaluation';
import { isCriticalDecision, maybeApplyIntentionalError } from '../../src/ai/errors/IntentionalError';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';

const NO_RISK: RiskAssessment = { edgeRisk: 0, opponentThreat: 0, selfVulnerability: 0, opportunity: 0, punishWindow: false, edgePressure: 0 };
const CRITICAL_EDGE_RISK: RiskAssessment = { edgeRisk: 0.95, opponentThreat: 0, selfVulnerability: 0, opportunity: 0, punishWindow: false, edgePressure: 0 };

const decision: IntentDecision = { intent: AiIntent.AttackDash, reason: 'test' };
const edgeDecision: IntentDecision = { intent: AiIntent.RecoverFromEdge, reason: 'edge risk high' };

describe('maybeApplyIntentionalError', () => {
  it('never downgrades a critical edge-recovery decision', () => {
    // errorRate=1 would always trigger a downgrade for any other intent —
    // this proves the critical-edge guard specifically, not just low luck.
    const alwaysErrorPersonality = { ...ATTACK_AI_PERSONALITY, errorRate: 1 };
    const rng = SeededRng.fromSeedText('critical-edge');
    const result = maybeApplyIntentionalError(edgeDecision, CRITICAL_EDGE_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng);
    expect(result.decision.intent).toBe(AiIntent.RecoverFromEdge);
    expect(result.errorApplied).toBe(false);
  });

  it('never applies an error when errorRate is 0', () => {
    const rng = SeededRng.fromSeedText('no-error');
    const noErrorPersonality = { ...ATTACK_AI_PERSONALITY, errorRate: 0 };
    for (let i = 0; i < 50; i++) {
      const result = maybeApplyIntentionalError(decision, NO_RISK, noErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng);
      expect(result.errorApplied).toBe(false);
      expect(result.decision.intent).toBe(AiIntent.AttackDash);
    }
  });

  it('when an error is applied, either downgrades to Wait/Circle OR keeps the ideal intent with a bounded extra delay — never anything else', () => {
    const alwaysErrorPersonality = { ...ATTACK_AI_PERSONALITY, errorRate: 1 };
    const rng = SeededRng.fromSeedText('always-error');
    let sawDowngrade = false;
    let sawExtraDelay = false;
    for (let i = 0; i < 50; i++) {
      const result = maybeApplyIntentionalError(decision, NO_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng);
      if (!result.errorApplied) continue;
      if (result.decision.intent === decision.intent) {
        // "Slow to react": same intent, acted on later (AIController.pendingDecision).
        expect(result.extraDelaySeconds).toBeGreaterThanOrEqual(0.05);
        expect(result.extraDelaySeconds).toBeLessThanOrEqual(0.4);
        sawExtraDelay = true;
      } else {
        expect([AiIntent.Wait, AiIntent.Circle]).toContain(result.decision.intent);
        expect(result.extraDelaySeconds).toBe(0);
        sawDowngrade = true;
      }
    }
    // Both kinds show up over 50 rolls at errorRate 1 (a coin flip each).
    expect(sawDowngrade).toBe(true);
    expect(sawExtraDelay).toBe(true);
  });

  it('never applies an error of either kind to AirRecover, or to an edge-safe evasion at critical edge risk', () => {
    const alwaysErrorPersonality = { ...ATTACK_AI_PERSONALITY, errorRate: 1 };
    const rng = SeededRng.fromSeedText('immune');
    const critical = { ...NO_RISK, edgeRisk: 0.95 };
    for (let i = 0; i < 20; i++) {
      const air = maybeApplyIntentionalError({ intent: AiIntent.AirRecover, reason: 'airborne' }, NO_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng);
      expect(air.errorApplied).toBe(false);
      expect(air.extraDelaySeconds).toBe(0);
      const evade = maybeApplyIntentionalError(
        { intent: AiIntent.DodgeThreat, reason: 'edge-safe dodge', edgeRecovery: true },
        critical,
        alwaysErrorPersonality,
        DEFAULT_AI_DIFFICULTY_PROFILE,
        rng,
      );
      expect(evade.errorApplied).toBe(false);
    }
  });

  it('is deterministic for a given seed', () => {
    const personality = { ...ATTACK_AI_PERSONALITY, errorRate: 0.5 };
    const rngA = SeededRng.fromSeedText('same-seed');
    const rngB = SeededRng.fromSeedText('same-seed');
    for (let i = 0; i < 20; i++) {
      const resultA = maybeApplyIntentionalError(decision, NO_RISK, personality, DEFAULT_AI_DIFFICULTY_PROFILE, rngA);
      const resultB = maybeApplyIntentionalError(decision, NO_RISK, personality, DEFAULT_AI_DIFFICULTY_PROFILE, rngB);
      expect(resultA.decision.intent).toBe(resultB.decision.intent);
      expect(resultA.errorApplied).toBe(resultB.errorApplied);
    }
  });
});

describe('isCriticalDecision (no deliberate error; replaces a pending late reaction)', () => {
  const risk = (edgeRisk: number, opponentThreat = 0): RiskAssessment => ({ ...NO_RISK, edgeRisk, opponentThreat });

  it('air recovery is always critical', () => {
    expect(isCriticalDecision({ intent: AiIntent.AirRecover, reason: 't' }, NO_RISK)).toBe(true);
  });

  it('edge recovery and edge-safe evasion are critical only at/above the critical edge risk', () => {
    expect(isCriticalDecision(edgeDecision, risk(0.85))).toBe(true);
    expect(isCriticalDecision(edgeDecision, risk(0.84))).toBe(false);
    const edgeSafeDodge: IntentDecision = { intent: AiIntent.DodgeThreat, reason: 't', edgeRecovery: true };
    expect(isCriticalDecision(edgeSafeDodge, risk(0.9, 1))).toBe(true);
    expect(isCriticalDecision(edgeSafeDodge, risk(0.6, 1))).toBe(false);
  });

  it('a normal threat response, attacks and everything else are not — even with a live threat', () => {
    for (const intent of [AiIntent.DodgeThreat, AiIntent.Retreat, AiIntent.AttackDash, AiIntent.AttackCircular, AiIntent.CounterAttack, AiIntent.PressAdvantage, AiIntent.Approach, AiIntent.Circle, AiIntent.Wait]) {
      expect(isCriticalDecision({ intent, reason: 't' }, risk(0.95, 1)), intent).toBe(false);
    }
  });
});
