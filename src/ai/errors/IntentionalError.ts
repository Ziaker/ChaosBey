// ============================================================
// AI INTENTIONAL ERROR (MILESTONE 7)
// GDD section 63/65: "deliberate errors ... error rate varies by
// difficulty" plus a debug-visible "deliberate-error event if one
// occurred". Applied as a separate step AFTER IntentSelection.ts's pure
// scoring, so the "ideal" decision stays inspectable in AiDebugState even
// when this substitutes a weaker one for humanization.
//
// Two kinds of mistake, each bounded and safe:
// - Intent downgrade: a passive/neutral intent (Wait or Circle) replaces
//   the ideal one — indecision about WHAT to do.
// - Slow to react: the ideal intent is kept, but AIController only starts
//   acting on it after a bounded extra delay, continuing its previous
//   intent meanwhile (see AIController.pendingDecision) — GDD section 63's
//   "artificial reaction delay" made variable.
// Neither can invent an unsafe action, skip air recovery, or skip a
// critical edge recovery; a mistake means hesitation, not a cheat or glitch
// (GDD section 63: lower difficulty may be imperfect, not broken).
// ============================================================

import type { SeededRng } from '../../rng/SeededRng';
import type { AiDifficultyProfile } from '../difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../personalities/AiPersonality';
import { AiIntent } from './../decision/Intent';
import type { IntentDecision } from '../decision/IntentSelection';
import type { RiskAssessment } from '../decision/RiskEvaluation';

/** Above this edge risk, recovery is never downgraded by a deliberate error — GDD section 129's "do not give AI hidden teleport recovery" is about not cheating recovery, not about being allowed to skip it outright at real danger. */
const CRITICAL_EDGE_RISK = 0.85;

/** Maximum extra delay (seconds) a "slow to react" error can add before the decision is acted on — bounded so a mistake reads as human hesitation, not the AI freezing. */
const MAX_EXTRA_DELAY_S = 0.4;
/** Minimum extra delay (seconds) of a "slow to react" error. */
const MIN_EXTRA_DELAY_S = 0.05;

export interface ErrorAppliedResult {
  decision: IntentDecision;
  errorApplied: boolean;
  /** Seconds before AIController starts acting on `decision` (it keeps its previous intent meanwhile) — 0 unless the "slow to react" kind was rolled. */
  extraDelaySeconds: number;
}

const SAFE_DOWNGRADE_INTENTS: readonly AiIntent[] = [AiIntent.Wait, AiIntent.Circle];

/**
 * The decisions no deliberate error may touch: air recovery (GDD section
 * 21 answers a short, physically real window) and a critical edge
 * recovery — including an edge-safe evasion inside one — which must still
 * be attempted (GDD section 129). AIController also lets these replace a
 * late ("slow to react") decision still pending, so a humanization delay
 * can't make the AI sit out a survival situation that arose after it.
 */
export function isCriticalDecision(decision: IntentDecision, risk: RiskAssessment): boolean {
  if (decision.intent === AiIntent.AirRecover) return true;
  return (decision.intent === AiIntent.RecoverFromEdge || decision.edgeRecovery === true) && risk.edgeRisk >= CRITICAL_EDGE_RISK;
}

export function maybeApplyIntentionalError(
  decision: IntentDecision,
  risk: RiskAssessment,
  personality: AiPersonality,
  difficulty: AiDifficultyProfile,
  rng: SeededRng,
): ErrorAppliedResult {
  if (isCriticalDecision(decision, risk)) {
    return { decision, errorApplied: false, extraDelaySeconds: 0 };
  }

  const effectiveErrorRate = Math.max(0, Math.min(1, personality.errorRate * difficulty.errorRateMultiplier));
  if (!rng.nextBool(effectiveErrorRate)) {
    return { decision, errorApplied: false, extraDelaySeconds: 0 };
  }

  // Two kinds of mistake, chosen by coin flip — see file header.
  if (rng.nextBool(0.5)) {
    const extraDelaySeconds = rng.nextRange(MIN_EXTRA_DELAY_S, MAX_EXTRA_DELAY_S);
    return {
      decision: { ...decision, reason: `deliberate error: slow to react (+${extraDelaySeconds.toFixed(2)}s) on "${decision.intent}" (${decision.reason})` },
      errorApplied: true,
      extraDelaySeconds,
    };
  }

  const downgrade = SAFE_DOWNGRADE_INTENTS[rng.nextInt(0, SAFE_DOWNGRADE_INTENTS.length - 1)] ?? AiIntent.Wait;
  if (downgrade === decision.intent) {
    return { decision, errorApplied: false, extraDelaySeconds: 0 };
  }

  return {
    decision: { intent: downgrade, reason: `deliberate error: hesitated instead of "${decision.intent}" (${decision.reason})` },
    errorApplied: true,
    extraDelaySeconds: 0,
  };
}
