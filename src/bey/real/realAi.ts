// ============================================================
// BEY REAL — THE OPPONENT'S TWO SLIDERS
// The lab's AI had two numbers: how often it attacks (aggression) and how fast and cleanly it reacts (skill). In the game the
// opponent is the game's own AI (its style and difficulty rows of the Pregame); in a Bey Real match the two sliders take the
// place of the tendencies they stand for: the personality's aggression, and the difficulty's reaction, error and evasion.
// Everything else the chosen style and difficulty give (prediction, adaptation, Clash mashing, arena awareness) stays.
// ============================================================

import type { AiDifficultyProfile } from '../../ai/difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../../ai/personalities/AiPersonality';
import type { RealModeConfig } from './RealTuning';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.min(1, Math.max(0, t));

/** Skill 0 = slow and sloppy, 1 = quick and clean (never perfect: errors and dodges keep the AI's own floor and cap). */
export function realAiDifficulty(base: AiDifficultyProfile, real: RealModeConfig): AiDifficultyProfile {
  return {
    ...base,
    reactionDelayMultiplier: lerp(1.8, 0.4, real.aiSkill),
    errorRateMultiplier: lerp(1.8, 0.3, real.aiSkill),
    evasionMultiplier: lerp(0.5, 1.4, real.aiSkill),
  };
}

export function realAiPersonality(base: AiPersonality, real: RealModeConfig): AiPersonality {
  return { ...base, aggression: Math.min(1, Math.max(0, real.aiAggression)) };
}
