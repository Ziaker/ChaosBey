// ============================================================
// AI INTENTIONAL ERROR (MILESTONE 7)
// GDD section 63/65: "deliberate errors ... error rate varies by
// difficulty" plus a debug-visible "deliberate-error event if one
// occurred". Applied as a separate step AFTER IntentSelection.ts's pure
// scoring, so the "ideal" decision stays inspectable in AiDebugState even
// when this substitutes a weaker one for humanization.
//
// Two distinct kinds of mistake, each individually bounded and safe:
// - Intent downgrade: substitutes a passive/neutral intent (Wait or
//   Circle) for the ideal one — a moment of indecision about WHAT to do.
// - Extra reaction delay: keeps the ideal intent, but AIController only
//   starts acting on it after a bounded extra delay, continuing its
//   previous intent meanwhile — a moment of being slow to act, GDD section
//   63's "artificial reaction delay" made variable rather than a fixed
//   personality constant (see AIController.pendingDecision).
// Neither can ever invent an unsafe action, ignore a critical edge-recovery
// or air-recovery need, or otherwise behave like a hidden cheat/glitch.
// ============================================================

import type { SeededRng } from '../../rng/SeededRng';
import type { AiDifficultyProfile } from '../difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../personalities/AiPersonality';
import { AiIntent } from './../decision/Intent';
import type { IntentDecision } from '../decision/IntentSelection';
import type { RiskAssessment } from '../decision/RiskEvaluation';

/** Above this edge risk, recovery is never downgraded/delayed by a deliberate error — GDD section 129's "do not give AI hidden teleport recovery" is about not cheating recovery, not about being allowed to skip it outright at real danger. */
const CRITICAL_EDGE_RISK = 0.85;
/** Maximum extra delay (seconds) an "extra reaction delay" error can add before the decision is acted on — bounded so a mistake reads as human hesitation, not the AI freezing. */
const MAX_EXTRA_DELAY_S = 0.4;

export interface ErrorAppliedResult {
  decision: IntentDecision;
  errorApplied: boolean;
  /** Seconds before AIController starts acting on `decision` (it keeps its previous intent meanwhile) — 0 unless this specific error variant was rolled. */
  extraDelaySeconds: number;
}

const SAFE_DOWNGRADE_INTENTS: readonly AiIntent[] = [AiIntent.Wait, AiIntent.Circle];

export function maybeApplyIntentionalError(
  decision: IntentDecision,
  risk: RiskAssessment,
  personality: AiPersonality,
  difficulty: AiDifficultyProfile,
  rng: SeededRng,
): ErrorAppliedResult {
  // Air recovery (GDD section 21) is never safe to delay or substitute away
  // from — the window it answers is already short and physically real.
  if (decision.intent === AiIntent.AirRecover) {
    return { decision, errorApplied: false, extraDelaySeconds: 0 };
  }
  if (decision.intent === AiIntent.RecoverFromEdge && risk.edgeRisk >= CRITICAL_EDGE_RISK) {
    return { decision, errorApplied: false, extraDelaySeconds: 0 };
  }

  const effectiveErrorRate = Math.max(0, Math.min(1, personality.errorRate * difficulty.errorRateMultiplier));
  if (!rng.nextBool(effectiveErrorRate)) {
    return { decision, errorApplied: false, extraDelaySeconds: 0 };
  }

  // Coin flip between the two error kinds — see file header.
  if (rng.nextBool(0.5)) {
    const extraDelaySeconds = rng.nextRange(0.05, MAX_EXTRA_DELAY_S);
    return {
      decision: { intent: decision.intent, reason: `deliberate error: slow to react (+${extraDelaySeconds.toFixed(2)}s) on "${decision.intent}" (${decision.reason})` },
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
