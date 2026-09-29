// ============================================================
// AI DIFFICULTY PROFILE — INTERNAL, DATA-DRIVEN (MILESTONE 7)
// GDD section 59/171 item 4: "the exact number and names of difficulty
// tiers were not definitively chosen" and "do not silently choose the
// final tier count" — that decision is [OWNER REQUIRED] and stays
// unresolved here. What GDD section 59 DOES approve is preparing "the
// architecture ... to support data-driven difficulty profiles before the
// player-facing tier list is approved" — this file is exactly that: a
// profile shape or number of profiles, is a free implementation detail
// until a player-facing UI is built on top of it (Milestone 10), NOT a
// commitment to any particular tier count/name.
//
// A difficulty profile modulates AiPersonality's tendencies (reaction
// speed, prediction, error rate, adaptation) without changing WHAT the AI
// wants to do — that's the personality's job (GDD section 64's "tendencies,
// not scripts" applies here too). Multipliers close to 1 = no change from
// the personality's own baseline.
// ============================================================

import type { AiPersonality } from '../personalities/AiPersonality';

export interface AiDifficultyProfile {
  readonly id: string;

  /** Multiplies AiPersonality.reactionDelaySeconds. <1 = faster/more consistent reactions (GDD section 59: "reaction time"). */
  readonly reactionDelayMultiplier: number;

  /** Multiplies AiPersonality.errorRate. <1 = fewer deliberate mistakes (GDD section 59: "error rate"). Never reaches 0 — GDD section 63: higher difficulty must feel smarter/faster/more consistent, never omniscient/perfect. */
  readonly errorRateMultiplier: number;

  /**
   * 0..1. How much of the opponent's predicted future position (extrapolated
   * from current velocity — see AiPerception.ts) is blended into targeting/
   * intercept decisions versus reacting to their current position only.
   * GDD section 59: "prediction". 0 = no prediction (react to where the
   * opponent is right now); 1 = fully trust the short-horizon extrapolation.
   */
  readonly predictionStrength: number;

  /** Multiplies AiPersonality.adaptationRate. 0 disables adaptation outright (GDD section 111: "Adaptation: none / partial / strong" is an approved difficulty axis). */
  readonly adaptationMultiplier: number;

  /** Multiplies AiPersonality.clashMashRatePerSecond (GDD section 59: "Clash mash performance"). */
  readonly clashMashRateMultiplier: number;

  /** Multiplies AiPersonality.dodgeSkill, capped at MAX_SCALED_DODGE_SKILL (M10: "evasion" — how often a threatened dodge actually fires in time). */
  readonly evasionMultiplier: number;

  /** Multiplies AiPersonality.edgeCautionMultiplier, never below 1 (M10: "arena awareness" — how strongly ring-out danger weighs). */
  readonly arenaAwarenessMultiplier: number;
}

/** Highest dodge skill a difficulty can scale a personality up to. */
export const MAX_SCALED_DODGE_SKILL = 0.95;

/**
 * The personality a difficulty profile plays: its evasion and arena
 * awareness scaled. With both multipliers at 1 (the default profile) the
 * personality is returned unchanged. The other axes (reaction, errors,
 * prediction, adaptation, Clash mash) are applied where AIController reads
 * them.
 */
export function applyDifficultyTraits(personality: AiPersonality, difficulty: AiDifficultyProfile): AiPersonality {
  if (difficulty.evasionMultiplier === 1 && difficulty.arenaAwarenessMultiplier === 1) return personality;
  return {
    ...personality,
    // Never a guaranteed dodge (GDD 63: never perfect); a personality already above the cap keeps its own value.
    dodgeSkill: Math.min(Math.max(MAX_SCALED_DODGE_SKILL, personality.dodgeSkill), Math.max(0, personality.dodgeSkill * difficulty.evasionMultiplier)),
    // AiPersonality: no profile may ignore ring-out risk, so never below 1.
    edgeCautionMultiplier: Math.max(1, personality.edgeCautionMultiplier * difficulty.arenaAwarenessMultiplier),
  };
}

/**
 * Single default internal profile (multipliers of 1 = the personality's own
 * baseline, unmodified). This is NOT a player-facing "Normal" tier — it is
 * simply what AIController falls back to until a pre-game difficulty
 * selection UI (Milestone 10) resolves and passes a real profile in. Adding
 * more named internal profiles here later is safe and does not by itself
 * decide the player-facing tier count/names.
 */
export const DEFAULT_AI_DIFFICULTY_PROFILE: AiDifficultyProfile = {
  id: 'default-ai-difficulty',
  reactionDelayMultiplier: 1,
  errorRateMultiplier: 1,
  predictionStrength: 0.5,
  adaptationMultiplier: 1,
  clashMashRateMultiplier: 1,
  evasionMultiplier: 1,
  arenaAwarenessMultiplier: 1,
};
