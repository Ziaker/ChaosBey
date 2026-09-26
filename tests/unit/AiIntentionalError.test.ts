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
import { maybeApplyIntentionalError } from '../../src/ai/errors/IntentionalError';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';

const NO_RISK: RiskAssessment = { edgeRisk: 0, opponentThreat: 0, selfVulnerability: 0, opportunity: 0 };
const CRITICAL_EDGE_RISK: RiskAssessment = { edgeRisk: 0.95, opponentThreat: 0, selfVulnerability: 0, opportunity: 0 };

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

  it('only ever downgrades to Wait or Circle when an error is applied', () => {
    const alwaysErrorPersonality = { ...ATTACK_AI_PERSONALITY, errorRate: 1 };
    const rng = SeededRng.fromSeedText('always-error');
    for (let i = 0; i < 50; i++) {
      const result = maybeApplyIntentionalError(decision, NO_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng);
      if (result.errorApplied) {
        expect([AiIntent.Wait, AiIntent.Circle]).toContain(result.decision.intent);
      }
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
