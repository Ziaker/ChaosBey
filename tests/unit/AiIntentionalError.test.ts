// ============================================================
// AI INTENTIONAL ERROR — UNIT TESTS (MILESTONE 7)
// GDD section 63/65: deliberate errors only ever downgrade to a safe,
// passive intent OR keep the ideal intent but add a bounded extra reaction
// delay, and must never suppress a genuinely critical edge recovery or an
// air-recovery window (the AI must still "attempt recovery" — section 129).
// ============================================================

import { describe, expect, it } from 'vitest';
import { SeededRng } from '../../src/rng/SeededRng';
import { AiIntent } from '../../src/ai/decision/Intent';
import type { IntentDecision } from '../../src/ai/decision/IntentSelection';
import type { RiskAssessment } from '../../src/ai/decision/RiskEvaluation';
import { maybeApplyIntentionalError } from '../../src/ai/errors/IntentionalError';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';

const NO_RISK: RiskAssessment = { edgeRisk: 0, opponentThreat: 0, selfVulnerability: 0, opportunity: 0, edgePressureOpportunity: 0 };
const CRITICAL_EDGE_RISK: RiskAssessment = { edgeRisk: 0.95, opponentThreat: 0, selfVulnerability: 0, opportunity: 0, edgePressureOpportunity: 0 };

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
      if (result.decision.intent === AiIntent.AttackDash) {
        // The "slow to react" variant — intent unchanged, only delayed.
        expect(result.extraDelaySeconds).toBeGreaterThan(0);
        sawExtraDelay = true;
      } else {
        expect([AiIntent.Wait, AiIntent.Circle]).toContain(result.decision.intent);
        expect(result.extraDelaySeconds).toBe(0);
        sawDowngrade = true;
      }
    }
    // Both variants should show up over 50 rolls with errorRate=1 (a 50/50
    // coin flip per occurrence) — otherwise this test isn't exercising both.
    expect(sawDowngrade).toBe(true);
    expect(sawExtraDelay).toBe(true);
  });

  it('never applies an error (of either kind) to an active AirRecover decision', () => {
    const alwaysErrorPersonality = { ...ATTACK_AI_PERSONALITY, errorRate: 1 };
    const airRecoverDecision: IntentDecision = { intent: AiIntent.AirRecover, reason: 'airborne' };
    const rng = SeededRng.fromSeedText('air-recover-immune');
    for (let i = 0; i < 20; i++) {
      const result = maybeApplyIntentionalError(airRecoverDecision, NO_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng);
      expect(result.errorApplied).toBe(false);
      expect(result.decision.intent).toBe(AiIntent.AirRecover);
      expect(result.extraDelaySeconds).toBe(0);
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
