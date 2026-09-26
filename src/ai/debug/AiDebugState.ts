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
import type { IntentScore } from '../decision/IntentSelection';

export interface AiDebugState {
  personalityId: string;
  difficultyProfileId: string;
  /** The intent IntentSelection.ts chose this decision tick, before any deliberate-error downgrade. */
  idealIntent: AiIntent;
  idealIntentReason: string;
  /** Every candidate intent's score from the latest fresh decision, best first (GDD section 65 "considered action scores"); empty when a hard override (air recovery, edge danger, threat) decided without scoring. */
  consideredScores: readonly IntentScore[];
  /** The intent actually acted on this decision tick — equal to idealIntent unless deliberateErrorApplied is true. */
  activeIntent: AiIntent;
  activeIntentReason: string;
  deliberateErrorApplied: boolean;
  /** The outcome of AiPersonality.dodgeSkill's single pre-roll for the current decision (see AIController.makeFreshDecision) — only meaningful while activeIntent is DodgeThreat. Exposed for GDD section 65's "why a dodge/jump was chosen" and to make the once-per-decision (not once-per-tick) rolling semantics independently observable. */
  dodgeAttemptSucceeds: boolean;
  targetPositionXZ: Vec2;
  /** Where the AI is actually steering: targetPositionXZ blended toward its predicted position by the difficulty's predictionStrength (GDD section 65 "predicted path"). */
  aimPositionXZ: Vec2;
  distanceToOpponentM: number;
  edgeRiskFraction: number;
  opponentThreatFraction: number;
  selfVulnerabilityFraction: number;
  opportunityFraction: number;
  /** GDD section 63: "AI exploits opponents near the edge" — how attractive pressing the opponent is right now specifically because they're boundary-exposed (see RiskEvaluation.ts), independent of opportunityFraction. */
  edgePressureOpportunityFraction: number;
  /** Seconds since the last fresh decision (GDD section 65 "reaction timer") — resets to 0 the tick a new decision is made. */
  reactionTimerS: number;
  /** A fresh decision already made but not yet acted on because a "slow to react" deliberate error delayed it (see AIController.pendingDecision); null when none is pending. */
  pendingIntent: AiIntent | null;
  /** Simulated seconds left before pendingIntent takes over from activeIntent (0 when none is pending). */
  pendingDelayRemainingS: number;
  /** Short label for whatever concrete action was pressed this tick (attack/dodge/jump/movement), for a one-line debug summary. */
  chosenActionSummary: string;
  observedOpponentAggressionFraction: number;
  observedOpponentDodgeRate: number;
  observedOpponentDashPreference: number;
}
