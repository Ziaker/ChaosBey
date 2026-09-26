// ============================================================
// AI ADAPTATION TRACKER (MILESTONE 7)
// GDD section 63: "AI can adapt to player habits during a fight." Kept
// deliberately small and legible (three named exponential moving averages,
// each with an obvious meaning) rather than a black-box learned model — GDD
// section 65 requires this to be debug-inspectable, and GDD section 99
// asks for code another AI agent can reason about without archaeology.
//
// Reads only public, already-perceived state (PerceivedCombatant) — no
// access to anything a spectator couldn't also observe over time, so
// adaptation is pattern-reading, not a hidden-information cheat.
// ============================================================

import { AttackState } from '../../combat/attacks/AttackController';
import { DodgeState } from '../../dodge/DodgeController';
import type { PerceivedCombatant } from '../perception/AiPerception';
import type { AiPersonality } from '../personalities/AiPersonality';

export interface AdaptationSnapshot {
  /** 0..1 EMA: how often the opponent has recently been in an active/charging attack state — a rough "how aggressive is this opponent playing" read. */
  observedAggressionFraction: number;
  /** 0..1 EMA: how often the opponent has recently been actively dodging. */
  observedDodgeRate: number;
  /** 0..1 EMA: recent preference for Dash Attack over Circular Attack (0 = only Circular, 1 = only Dash) when attacking at all. */
  observedDashPreference: number;
}

const INITIAL_AGGRESSION_ESTIMATE = 0.3;
const INITIAL_DODGE_ESTIMATE = 0.1;
const INITIAL_DASH_PREFERENCE_ESTIMATE = 0.5;

/** Small, bounded nudge caps — adaptation biases the personality it's given, it never overrides it (GDD section 64's tendencies stay tendencies). */
const MAX_CAUTION_NUDGE = 0.15;
const MAX_AGGRESSION_NUDGE = 0.1;

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

export class AdaptationTracker {
  private aggressionEma = INITIAL_AGGRESSION_ESTIMATE;
  private dodgeEma = INITIAL_DODGE_ESTIMATE;
  private dashPreferenceEma = INITIAL_DASH_PREFERENCE_ESTIMATE;

  /** Call once per decision tick (not every fixed tick — see AIController's reaction-delay cadence) with the opponent's current perceived state and a 0..1 EMA smoothing factor for this update. */
  update(opponent: PerceivedCombatant, alpha: number): void {
    const clampedAlpha = clamp01(alpha);
    const isAttacking = opponent.attackState !== AttackState.Neutral ? 1 : 0;
    this.aggressionEma += (isAttacking - this.aggressionEma) * clampedAlpha;

    const isDodging = opponent.dodgeState === DodgeState.Dodging ? 1 : 0;
    this.dodgeEma += (isDodging - this.dodgeEma) * clampedAlpha;

    if (opponent.attackState === AttackState.DashActive || opponent.attackState === AttackState.ChargingDash) {
      this.dashPreferenceEma += (1 - this.dashPreferenceEma) * clampedAlpha;
    } else if (opponent.attackState === AttackState.CircularActive) {
      this.dashPreferenceEma += (0 - this.dashPreferenceEma) * clampedAlpha;
    }
  }

  getSnapshot(): AdaptationSnapshot {
    return {
      observedAggressionFraction: this.aggressionEma,
      observedDodgeRate: this.dodgeEma,
      observedDashPreference: this.dashPreferenceEma,
    };
  }
}

/**
 * Returns a copy of `personality` with a small, bounded bias applied from
 * observed opponent tendencies, scaled by both this AI's own
 * adaptationRate and the active difficulty's adaptationMultiplier (0
 * disables this entirely — GDD section 111's "Adaptation: none / partial /
 * strong" axis). A highly aggressive opponent nudges caution up (play
 * safer against pressure); a highly passive opponent nudges aggression up
 * (press the advantage) — never enough to override the archetype's own
 * identity, only to lean it slightly.
 */
export function applyAdaptationNudge(
  personality: AiPersonality,
  snapshot: AdaptationSnapshot,
  effectiveAdaptationRate: number,
): AiPersonality {
  const rate = clamp01(effectiveAdaptationRate);
  if (rate <= 0) return personality;

  // A more-aggressive-than-baseline opponent nudges caution up; a
  // more-passive-than-baseline opponent nudges aggression up (press the
  // advantage) — the two nudges are intentionally independent (both react
  // to the same observed signal, but neither is derived from the other).
  const cautionNudge = (snapshot.observedAggressionFraction - INITIAL_AGGRESSION_ESTIMATE) * MAX_CAUTION_NUDGE * rate;
  const aggressionNudge = (INITIAL_AGGRESSION_ESTIMATE - snapshot.observedAggressionFraction) * MAX_AGGRESSION_NUDGE * rate;

  return {
    ...personality,
    caution: clamp01(personality.caution + cautionNudge),
    aggression: clamp01(personality.aggression + aggressionNudge),
  };
}
