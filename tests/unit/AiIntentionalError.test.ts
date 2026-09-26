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
import { maybeApplyIntentionalError, SLOW_TO_REACT_MAX_DELAY_S, SLOW_TO_REACT_MIN_DELAY_S } from '../../src/ai/errors/IntentionalError';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';

const NO_RISK: RiskAssessment = { edgeRisk: 0, opponentThreat: 0, selfVulnerability: 0, opportunity: 0, punishWindow: false, edgePressure: 0, immediateThreat: false };
const CRITICAL_EDGE_RISK: RiskAssessment = { edgeRisk: 0.95, opponentThreat: 0, selfVulnerability: 0, opportunity: 0, punishWindow: false, edgePressure: 0, immediateThreat: false };

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

  it('only ever downgrades to Wait or Circle, or keeps the intent and delays it (slow to react), when an error is applied', () => {
    const alwaysErrorPersonality = { ...ATTACK_AI_PERSONALITY, errorRate: 1 };
    const rng = SeededRng.fromSeedText('always-error');
    for (let i = 0; i < 50; i++) {
      const result = maybeApplyIntentionalError(decision, NO_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng);
      if (result.errorApplied && result.reactionDelayS === 0) {
        expect([AiIntent.Wait, AiIntent.Circle]).toContain(result.decision.intent);
      }
      if (result.reactionDelayS > 0) expect(result.decision.intent).toBe(AiIntent.AttackDash);
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

describe('maybeApplyIntentionalError — critical decisions (M7 Part 2b)', () => {
  it('never downgrades a critical decision (AirRecover), even with errorRate 1 and no edge risk', () => {
    const alwaysErrorPersonality = { ...ATTACK_AI_PERSONALITY, errorRate: 1 };
    const rng = SeededRng.fromSeedText('air-recover-critical');
    const airRecover: IntentDecision = { intent: AiIntent.AirRecover, reason: 'launched', critical: true };
    for (let i = 0; i < 50; i++) {
      const result = maybeApplyIntentionalError(airRecover, NO_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng, AiIntent.Circle);
      expect(result.decision.intent).toBe(AiIntent.AirRecover);
      expect(result.errorApplied).toBe(false);
      expect(result.reactionDelayS, 'never delayed either').toBe(0);
    }
  });
});

describe('maybeApplyIntentionalError — slow to react (M7 Part 2b)', () => {
  const alwaysErrorPersonality = { ...ATTACK_AI_PERSONALITY, errorRate: 1 };

  it('keeps the ideal intent and returns a bounded delay; every other error is a Wait/Circle downgrade with no delay', () => {
    const rng = SeededRng.fromSeedText('slow-kinds');
    let slow = 0;
    for (let i = 0; i < 200; i++) {
      const result = maybeApplyIntentionalError(decision, NO_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng, AiIntent.Circle);
      if (result.reactionDelayS > 0) {
        slow++;
        expect(result.decision.intent).toBe(AiIntent.AttackDash);
        expect(result.errorApplied).toBe(true);
        expect(result.reactionDelayS).toBeGreaterThanOrEqual(SLOW_TO_REACT_MIN_DELAY_S);
        expect(result.reactionDelayS).toBeLessThanOrEqual(SLOW_TO_REACT_MAX_DELAY_S);
      } else if (result.errorApplied) {
        expect([AiIntent.Wait, AiIntent.Circle]).toContain(result.decision.intent);
      }
    }
    expect(slow, 'the slow-to-react kind does occur').toBeGreaterThan(0);
  });

  it('is never applied to the intent already being acted on (it would change nothing)', () => {
    const rng = SeededRng.fromSeedText('slow-same-intent');
    for (let i = 0; i < 100; i++) {
      expect(maybeApplyIntentionalError(decision, NO_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng, AiIntent.AttackDash).reactionDelayS).toBe(0);
    }
  });

  it('never delays a critical edge recovery', () => {
    const rng = SeededRng.fromSeedText('slow-critical-edge');
    for (let i = 0; i < 50; i++) {
      expect(maybeApplyIntentionalError(edgeDecision, CRITICAL_EDGE_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, rng, AiIntent.Circle).reactionDelayS).toBe(0);
    }
  });

  it('draws the same delays for the same seed', () => {
    const a = SeededRng.fromSeedText('slow-seed');
    const b = SeededRng.fromSeedText('slow-seed');
    for (let i = 0; i < 30; i++) {
      const ra = maybeApplyIntentionalError(decision, NO_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, a, AiIntent.Circle);
      const rb = maybeApplyIntentionalError(decision, NO_RISK, alwaysErrorPersonality, DEFAULT_AI_DIFFICULTY_PROFILE, b, AiIntent.Circle);
      expect(ra.reactionDelayS).toBe(rb.reactionDelayS);
      expect(ra.decision.intent).toBe(rb.decision.intent);
    }
  });
});
