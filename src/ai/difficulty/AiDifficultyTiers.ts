// ============================================================
// AI DIFFICULTY TIERS — ROOKIE / RIVAL / ACE (M10)
// The player-facing tiers, approved provisionally by the owner for M10
// (docs/ai/m10-status.md). Each tier is only an AiDifficultyProfile: the
// same AI pipeline and personality, with its skill axes scaled — never a
// separate behavior branch. Rival is the internal default profile the AI
// has played since M7, so the existing AI tests and batches describe it.
//
// Every number is a first pass for playtest (GDD 167). Two limits hold
// for every tier (GDD 63): mistakes never reach zero, and no tier ignores
// ring-out danger or skips air/edge recovery.
// ============================================================

import { DEFAULT_AI_DIFFICULTY_PROFILE, type AiDifficultyProfile } from './AiDifficultyProfile';

export type AiDifficultyTierId = 'rookie' | 'rival' | 'ace';

export interface AiDifficultyTier {
  readonly id: AiDifficultyTierId;
  readonly label: string;
  /** One line for the Pregame screen. */
  readonly summary: string;
  readonly profile: AiDifficultyProfile;
}

export const ROOKIE_TIER: AiDifficultyTier = {
  id: 'rookie',
  label: 'Rookie',
  summary: 'Slow to react and often hesitates. Rarely sees your moves coming and loses most Clashes.',
  profile: {
    id: 'tier-rookie',
    reactionDelayMultiplier: 1.8,
    errorRateMultiplier: 2.2,
    predictionStrength: 0.15,
    adaptationMultiplier: 0,
    clashMashRateMultiplier: 0.65,
    evasionMultiplier: 0.6,
    arenaAwarenessMultiplier: 0.85,
  },
};

export const RIVAL_TIER: AiDifficultyTier = {
  id: 'rival',
  label: 'Rival',
  summary: 'A fair fight. Reads your approach, dodges some attacks and learns your habits as the round goes on.',
  profile: { ...DEFAULT_AI_DIFFICULTY_PROFILE, id: 'tier-rival' },
};

export const ACE_TIER: AiDifficultyTier = {
  id: 'ace',
  label: 'Ace',
  summary: 'Fast, precise and adaptive. Anticipates where you are going, rarely misses a dodge and fights hard in Clashes.',
  profile: {
    id: 'tier-ace',
    reactionDelayMultiplier: 0.55,
    errorRateMultiplier: 0.35,
    predictionStrength: 0.85,
    adaptationMultiplier: 1.5,
    clashMashRateMultiplier: 1.3,
    evasionMultiplier: 1.35,
    arenaAwarenessMultiplier: 1.3,
  },
};

export const AI_DIFFICULTY_TIERS: readonly AiDifficultyTier[] = [ROOKIE_TIER, RIVAL_TIER, ACE_TIER];

export const DEFAULT_AI_DIFFICULTY_TIER: AiDifficultyTierId = 'rival';

export function aiDifficultyTier(id: AiDifficultyTierId): AiDifficultyTier {
  const tier = AI_DIFFICULTY_TIERS.find((t) => t.id === id);
  if (!tier) throw new Error(`AiDifficultyTiers: unknown tier "${id}".`);
  return tier;
}
