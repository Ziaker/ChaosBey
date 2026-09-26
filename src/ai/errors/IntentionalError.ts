// ============================================================
// AI INTENTIONAL ERROR (MILESTONE 7)
// GDD section 63/65: "deliberate errors ... error rate varies by
// difficulty" plus a debug-visible "deliberate-error event if one
// occurred". Applied as a separate step AFTER IntentSelection.ts's pure
// scoring, so the "ideal" decision stays inspectable in AiDebugState even
// when this substitutes a weaker one for humanization.
//
// Bounded by design: an error can only ever downgrade to a passive/neutral
// intent (Wait or Circle) — it can never invent an unsafe action, ignore a
// critical edge-recovery need, or otherwise behave like a hidden cheat/
// glitch. A "mistake" here means hesitation/indecision, the kind GDD
// section 63 describes ("do not let higher difficulty read the player's
// future input perfectly" implies lower difficulty is allowed to be
// imperfect, not broken).
// ============================================================

import type { SeededRng } from '../../rng/SeededRng';
import type { AiDifficultyProfile } from '../difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../personalities/AiPersonality';
import { AiIntent } from './../decision/Intent';
import type { IntentDecision } from '../decision/IntentSelection';
import type { RiskAssessment } from '../decision/RiskEvaluation';

/** Above this edge risk, recovery is never downgraded by a deliberate error — GDD section 129's "do not give AI hidden teleport recovery" is about not cheating recovery, not about being allowed to skip it outright at real danger. */
const CRITICAL_EDGE_RISK = 0.85;

export interface ErrorAppliedResult {
  decision: IntentDecision;
  errorApplied: boolean;
}

const SAFE_DOWNGRADE_INTENTS: readonly AiIntent[] = [AiIntent.Wait, AiIntent.Circle];

export function maybeApplyIntentionalError(
  decision: IntentDecision,
  risk: RiskAssessment,
  personality: AiPersonality,
  difficulty: AiDifficultyProfile,
  rng: SeededRng,
): ErrorAppliedResult {
  if (decision.intent === AiIntent.RecoverFromEdge && risk.edgeRisk >= CRITICAL_EDGE_RISK) {
    return { decision, errorApplied: false };
  }

  const effectiveErrorRate = Math.max(0, Math.min(1, personality.errorRate * difficulty.errorRateMultiplier));
  if (!rng.nextBool(effectiveErrorRate)) {
    return { decision, errorApplied: false };
  }

  const downgrade = SAFE_DOWNGRADE_INTENTS[rng.nextInt(0, SAFE_DOWNGRADE_INTENTS.length - 1)] ?? AiIntent.Wait;
  if (downgrade === decision.intent) {
    return { decision, errorApplied: false };
  }

  return {
    decision: { intent: downgrade, reason: `deliberate error: hesitated instead of "${decision.intent}" (${decision.reason})` },
    errorApplied: true,
  };
}
