// ============================================================
// AI INTENTIONAL ERROR (MILESTONE 7)
// GDD section 63/65: "deliberate errors ... error rate varies by
// difficulty" plus a debug-visible "deliberate-error event if one
// occurred". Applied as a separate step AFTER IntentSelection.ts's pure
// scoring, so the "ideal" decision stays inspectable in AiDebugState even
// when this substitutes a weaker one for humanization.
//
// Bounded by design — two kinds, neither of which can invent an unsafe
// action, touch a critical decision (air recovery, critical edge
// recovery), or otherwise behave like a hidden cheat/glitch:
// - Hesitation: downgrade to a passive/neutral intent (Wait or Circle).
// - Slow to react: keep the ideal decision but act on it only after a
//   bounded, seeded, one-shot delay; until then the current intent keeps
//   acting (AIController holds it as pending). GDD section 63's "artificial
//   reaction delay", made occasionally longer rather than a fixed constant.
// A "mistake" here means hesitation/lateness, the kind GDD section 63
// describes ("do not let higher difficulty read the player's future input
// perfectly" implies lower difficulty is allowed to be imperfect, not
// broken).
// ============================================================

import type { SeededRng } from '../../rng/SeededRng';
import type { AiDifficultyProfile } from '../difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../personalities/AiPersonality';
import { AiIntent } from './../decision/Intent';
import { CRITICAL_EDGE_RISK, type IntentDecision } from '../decision/IntentSelection';
import type { RiskAssessment } from '../decision/RiskEvaluation';

/** Slow to react: bounds (s) of the extra delay before the held-back decision is acted on — long enough to read as late, short enough never to look frozen. Engineering placeholders (GDD section 167). */
export const SLOW_TO_REACT_MIN_DELAY_S = 0.1;
export const SLOW_TO_REACT_MAX_DELAY_S = 0.35;

export interface ErrorAppliedResult {
  decision: IntentDecision;
  errorApplied: boolean;
  /** > 0 only for a slow-to-react error: act on `decision` only after this many seconds; until then the current intent keeps acting (see AIController). */
  reactionDelayS: number;
}

/** Which deliberate error a roll picked: one of the two hesitation downgrades, or slow to react. */
const ERROR_KINDS = [AiIntent.Wait, AiIntent.Circle, 'SlowToReact'] as const;


export function maybeApplyIntentionalError(
  decision: IntentDecision,
  risk: RiskAssessment,
  personality: AiPersonality,
  difficulty: AiDifficultyProfile,
  rng: SeededRng,
  /** The intent currently being acted on — a slow-to-react on the same intent would be a no-op, so it isn't applied. */
  currentIntent?: AiIntent,
): ErrorAppliedResult {
  // Critical decisions (IntentDecision.critical: air recovery, anything in
  // a critical edge episode) are never touched — GDD section 129's "do not
  // give AI hidden teleport recovery" is about not cheating recovery, not
  // about being allowed to skip or delay it at real danger.
  if (decision.critical || (decision.intent === AiIntent.RecoverFromEdge && risk.edgeRisk >= CRITICAL_EDGE_RISK)) {
    return { decision, errorApplied: false, reactionDelayS: 0 };
  }

  const effectiveErrorRate = Math.max(0, Math.min(1, personality.errorRate * difficulty.errorRateMultiplier));
  if (!rng.nextBool(effectiveErrorRate)) {
    return { decision, errorApplied: false, reactionDelayS: 0 };
  }

  const kind = ERROR_KINDS[rng.nextInt(0, ERROR_KINDS.length - 1)] ?? AiIntent.Wait;
  if (kind === 'SlowToReact') {
    // Being late to keep doing what it already does changes nothing.
    if (decision.intent === currentIntent) return { decision, errorApplied: false, reactionDelayS: 0 };
    const reactionDelayS = rng.nextRange(SLOW_TO_REACT_MIN_DELAY_S, SLOW_TO_REACT_MAX_DELAY_S);
    return {
      decision: { ...decision, reason: `deliberate error: slow to react (+${reactionDelayS.toFixed(2)}s) to "${decision.intent}" (${decision.reason})` },
      errorApplied: true,
      reactionDelayS,
    };
  }

  if (kind === decision.intent) {
    return { decision, errorApplied: false, reactionDelayS: 0 };
  }

  return {
    decision: { intent: kind, reason: `deliberate error: hesitated instead of "${decision.intent}" (${decision.reason})` },
    errorApplied: true,
    reactionDelayS: 0,
  };
}
