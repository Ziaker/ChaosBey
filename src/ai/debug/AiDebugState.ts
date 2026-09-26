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
  /** The intent actually acted on this decision tick — equal to idealIntent unless deliberateErrorApplied is true. */
  activeIntent: AiIntent;
  activeIntentReason: string;
  deliberateErrorApplied: boolean;
  /** A decision held back by a slow-to-react deliberate error, not acted on yet (the active intent keeps acting until it lands); null when none. */
  pendingIntent: AiIntent | null;
  /** Seconds until pendingIntent lands (0 when none). */
  pendingRemainingS: number;
  /** The outcome of AiPersonality.dodgeSkill's single pre-roll for the current decision (see AIController.makeFreshDecision) — only meaningful while activeIntent is DodgeThreat. Exposed for GDD section 65's "why a dodge/jump was chosen" and to make the once-per-decision (not once-per-tick) rolling semantics independently observable. */
  dodgeAttemptSucceeds: boolean;
  /** The opponent's position as observed right now (range checks use this). */
  observedOpponentXZ: Vec2;
  /** The point this AI aims at: observed, pulled toward predicted by predictionStrength (see WorldState.TargetingInfo). */
  aimPointXZ: Vec2;
  /** Linear extrapolation of the opponent predictionHorizonS ahead; null when prediction is off — never the observed position relabeled. */
  predictedOpponentXZ: Vec2 | null;
  predictionHorizonS: number;
  predictionStrength: number;
  /** Direction the active intent steered toward this tick; null when it had no movement goal. Differs from the aim point for Retreat, RecoverFromEdge, Circle and edge-pressure flanking. */
  moveDirectionXZ: Vec2 | null;
  distanceToOpponentM: number;
  edgeRiskFraction: number;
  opponentThreatFraction: number;
  selfVulnerabilityFraction: number;
  opportunityFraction: number;
  /** Seconds since the last fresh decision (GDD section 65 "reaction timer") — resets to 0 the tick a new decision is made. */
  reactionTimerS: number;
  /** Short label for whatever concrete action was pressed this tick (attack/dodge/jump/movement), for a one-line debug summary. */
  chosenActionSummary: string;
  observedOpponentAggressionFraction: number;
  observedOpponentDodgeRate: number;
  observedOpponentDashPreference: number;
}
