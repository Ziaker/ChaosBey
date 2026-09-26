// ============================================================
// AI DEBUG STATE (MILESTONE 7)
// GDD section 65: "Debug Mode must be able to display: AI current target,
// current intent, current decision, considered action scores where
// practical, reaction timer, perceived opponent state, edge risk,
// predicted path, chosen attack, why a dodge/jump was chosen, difficulty
// modifiers, deliberate-error event if one occurred." This is the single
// read-only snapshot AIController exposes each tick so a debug panel (or a
// test) can inspect exactly that, without reaching into the controller's
// private decision-pipeline objects.
// ============================================================

import type { Vec2 } from '../../physics/Vec2';
import type { AiIntent } from '../decision/Intent';

export interface AiDebugState {
  personalityId: string;
  difficultyProfileId: string;
  /** The intent IntentSelection.ts chose this decision tick, before any deliberate-error downgrade. */
  idealIntent: AiIntent;
  idealIntentReason: string;
  /** The best-scoring candidates behind idealIntent, e.g. "AttackCircular 0.72 / Circle 0.41 / Approach 0.20" — or "override (see reason)" when a hard override decided (GDD section 65: "considered action scores where practical"). */
  consideredScoresSummary: string;
  /** Every candidate intent and its score from the latest fresh decision, best first; empty when a hard override decided. */
  consideredScores: readonly { intent: AiIntent; score: number }[];
  /** The Clash-willingness multiplier the latest fresh decision's scoring applied to its attack candidates (IntentSelection.clashWillingness); 1 when none applied or a hard override decided. */
  clashWillingness: number;
  /** The intent actually acted on this decision tick — equal to idealIntent unless deliberateErrorApplied is true. */
  activeIntent: AiIntent;
  activeIntentReason: string;
  deliberateErrorApplied: boolean;
  /** The outcome of AiPersonality.dodgeSkill's single pre-roll for the current decision (see AIController.makeFreshDecision) — only meaningful while activeIntent is DodgeThreat. Exposed for GDD section 65's "why a dodge/jump was chosen" and to make the once-per-decision (not once-per-tick) rolling semantics independently observable. */
  dodgeAttemptSucceeds: boolean;
  /** The opponent's OBSERVED position (what range checks use). */
  targetPositionXZ: Vec2;
  /** Where the AI actually steers: the observed position blended toward the predicted one by the difficulty's predictionStrength (GDD section 65 "predicted path"). Kept separate from targetPositionXZ on purpose. */
  aimPositionXZ: Vec2;
  distanceToOpponentM: number;
  edgeRiskFraction: number;
  opponentThreatFraction: number;
  selfVulnerabilityFraction: number;
  opportunityFraction: number;
  /** Seconds since the last fresh decision (GDD section 65 "reaction timer") — resets to 0 the tick a new decision is made. */
  reactionTimerS: number;
  /** A fresh decision already made but not yet acted on, because a "slow to react" deliberate error delayed it (AIController.pendingDecision); null when none is pending. */
  pendingIntent: AiIntent | null;
  /** Simulated seconds left before pendingIntent takes over from activeIntent (0 when none is pending). */
  pendingDelayRemainingS: number;
  /** Short label for whatever concrete action was pressed this tick (attack/dodge/jump/movement), for a one-line debug summary. */
  chosenActionSummary: string;
  observedOpponentAggressionFraction: number;
  observedOpponentDodgeRate: number;
  observedOpponentDashPreference: number;
}
