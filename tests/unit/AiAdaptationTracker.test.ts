// ============================================================
// AI ADAPTATION TRACKER — UNIT TESTS (MILESTONE 7)
// GDD section 63: adaptation must be a small, legible, bounded nudge on
// top of a personality's own tendencies — never able to override its
// identity, and disabled outright when the effective adaptation rate is 0
// (GDD section 111's "Adaptation: none" difficulty axis).
// ============================================================

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { AdaptationTracker, applyAdaptationNudge } from '../../src/ai/adaptation/AdaptationTracker';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';

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

describe('AdaptationTracker', () => {
  it('aggression EMA rises toward 1 when the opponent is consistently attacking', () => {
    const tracker = new AdaptationTracker();
    const attackingOpponent = perceiveCombatant(rawState({ attackState: AttackState.DashActive }));
    let last = tracker.getSnapshot().observedAggressionFraction;
    for (let i = 0; i < 30; i++) {
      tracker.update(attackingOpponent, 0.2);
      const current = tracker.getSnapshot().observedAggressionFraction;
      expect(current).toBeGreaterThanOrEqual(last);
      last = current;
    }
    expect(last).toBeGreaterThan(0.9);
  });

  it('dash-preference EMA moves toward 1 for Dash-heavy play and toward 0 for Circular-heavy play', () => {
    const dashTracker = new AdaptationTracker();
    const circularTracker = new AdaptationTracker();
    const dashOpponent = perceiveCombatant(rawState({ attackState: AttackState.DashActive }));
    const circularOpponent = perceiveCombatant(rawState({ attackState: AttackState.CircularActive }));
    for (let i = 0; i < 30; i++) {
      dashTracker.update(dashOpponent, 0.2);
      circularTracker.update(circularOpponent, 0.2);
    }
    expect(dashTracker.getSnapshot().observedDashPreference).toBeGreaterThan(0.8);
    expect(circularTracker.getSnapshot().observedDashPreference).toBeLessThan(0.2);
  });
});

describe('applyAdaptationNudge', () => {
  it('returns the personality unchanged when the effective adaptation rate is 0', () => {
    const tracker = new AdaptationTracker();
    const aggressiveOpponent = perceiveCombatant(rawState({ attackState: AttackState.DashActive }));
    for (let i = 0; i < 30; i++) tracker.update(aggressiveOpponent, 0.2);
    const nudged = applyAdaptationNudge(DEFENSE_AI_PERSONALITY, tracker.getSnapshot(), 0);
    expect(nudged).toEqual(DEFENSE_AI_PERSONALITY);
  });

  it('nudges caution up (bounded) against a consistently aggressive opponent, without changing the personality identity beyond that bound', () => {
    const tracker = new AdaptationTracker();
    const aggressiveOpponent = perceiveCombatant(rawState({ attackState: AttackState.DashActive }));
    for (let i = 0; i < 30; i++) tracker.update(aggressiveOpponent, 0.2);
    const nudged = applyAdaptationNudge(DEFENSE_AI_PERSONALITY, tracker.getSnapshot(), 1);
    expect(nudged.caution).toBeGreaterThan(DEFENSE_AI_PERSONALITY.caution);
    expect(nudged.caution).toBeLessThanOrEqual(1);
    expect(nudged.caution - DEFENSE_AI_PERSONALITY.caution).toBeLessThanOrEqual(0.2);
    // Only caution/aggression are ever nudged — every other tendency stays exactly the archetype's own.
    expect(nudged.patience).toBe(DEFENSE_AI_PERSONALITY.patience);
    expect(nudged.dodgeSkill).toBe(DEFENSE_AI_PERSONALITY.dodgeSkill);
  });

  it('nudges preferredEngageRangeM outward, bounded, against a Dash-heavy, frequently dodging opponent (ported from PR #13)', () => {
    const tracker = new AdaptationTracker();
    const dashAndDodgeHeavyOpponent = perceiveCombatant(rawState({ attackState: AttackState.DashActive, dodgeState: DodgeState.Dodging }));
    for (let i = 0; i < 60; i++) tracker.update(dashAndDodgeHeavyOpponent, 0.2);
    const nudged = applyAdaptationNudge(DEFENSE_AI_PERSONALITY, tracker.getSnapshot(), 1);
    expect(nudged.preferredEngageRangeM).toBeGreaterThan(DEFENSE_AI_PERSONALITY.preferredEngageRangeM);
    expect(nudged.preferredEngageRangeM - DEFENSE_AI_PERSONALITY.preferredEngageRangeM).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it('never nudges preferredEngageRangeM inward, even against a passive, never-dodging, Circular-only opponent', () => {
    const tracker = new AdaptationTracker();
    for (let i = 0; i < 60; i++) tracker.update(perceiveCombatant(rawState({ attackState: AttackState.CircularActive })), 0.2);
    for (let i = 0; i < 60; i++) tracker.update(perceiveCombatant(rawState()), 0.2);
    const nudged = applyAdaptationNudge(DEFENSE_AI_PERSONALITY, tracker.getSnapshot(), 1);
    expect(nudged.preferredEngageRangeM).toBe(DEFENSE_AI_PERSONALITY.preferredEngageRangeM);
  });

  it('applies no engage-range nudge at all when adaptation is disabled (rate 0)', () => {
    const tracker = new AdaptationTracker();
    for (let i = 0; i < 60; i++) tracker.update(perceiveCombatant(rawState({ attackState: AttackState.DashActive })), 0.2);
    expect(applyAdaptationNudge(DEFENSE_AI_PERSONALITY, tracker.getSnapshot(), 0).preferredEngageRangeM).toBe(DEFENSE_AI_PERSONALITY.preferredEngageRangeM);
  });
});
