// ============================================================
// AI ARCHETYPE PERSONALITIES (MILESTONE 7)
// Concrete AiPersonality values for the three approved archetypes (GDD
// section 64), mirroring the BeyArchetypes.ts pattern: one exported const
// per archetype plus a lookup map, defaults never redeclared elsewhere.
// Every number is an engineering placeholder (GDD section 167) chosen only
// to make the three read as distinguishably different in the M7 self-tests
// — real balance tuning is a separate, later pass.
// ============================================================

import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../bey/archetype/BeyArchetypes';
import type { AiPersonality } from './AiPersonality';

/** Attack AI (GDD section 64): more aggressive — seeks engagement, uses charge opportunities, pressures broken Stability, takes more positional risk. */
export const ATTACK_AI_PERSONALITY: AiPersonality = {
  id: 'attack-ai-personality',
  aggression: 0.8,
  caution: 0.25,
  patience: 0.2,
  edgeCautionMultiplier: 1.0,
  dodgeSkill: 0.55,
  reactionDelaySeconds: 0.22,
  errorRate: 0.12,
  clashMashRatePerSecond: 6,
  adaptationRate: 0.3,
  preferredEngageRangeM: 2.5,
};

/** Defense AI (GDD section 64): more reactive — uses counter opportunities, manages spacing, uses wall/arena positioning, punishes commitment. */
export const DEFENSE_AI_PERSONALITY: AiPersonality = {
  id: 'defense-ai-personality',
  aggression: 0.35,
  caution: 0.75,
  patience: 0.55,
  edgeCautionMultiplier: 1.3,
  dodgeSkill: 0.75,
  reactionDelaySeconds: 0.16,
  errorRate: 0.08,
  clashMashRatePerSecond: 5,
  adaptationRate: 0.45,
  preferredEngageRangeM: 4.5,
};

/** Stamina AI (GDD section 64): more evasive — preserves resources, encourages long battles, avoids unnecessary heavy collisions, exploits fatigue. */
export const STAMINA_AI_PERSONALITY: AiPersonality = {
  id: 'stamina-ai-personality',
  aggression: 0.4,
  caution: 0.55,
  patience: 0.8,
  edgeCautionMultiplier: 1.15,
  dodgeSkill: 0.65,
  reactionDelaySeconds: 0.2,
  errorRate: 0.1,
  clashMashRatePerSecond: 5.5,
  adaptationRate: 0.5,
  preferredEngageRangeM: 5,
};

/** Neutral fallback for any BeyDefinition that isn't one of the three known archetypes (mirrors DEFAULT_BEY_DEFINITION's role in BeyArchetypes.ts). */
export const DEFAULT_AI_PERSONALITY: AiPersonality = {
  id: 'default-ai-personality',
  aggression: 0.5,
  caution: 0.5,
  patience: 0.5,
  edgeCautionMultiplier: 1.1,
  dodgeSkill: 0.6,
  reactionDelaySeconds: 0.2,
  errorRate: 0.1,
  clashMashRatePerSecond: 5.5,
  adaptationRate: 0.35,
  preferredEngageRangeM: 3.5,
};

/** Looked up by BeyDefinition.id — the same key AttackProfileSettings.ts matches archetypes by. */
export function personalityForBeyDefinitionId(definitionId: string): AiPersonality {
  switch (definitionId) {
    case ATTACK_ARCHETYPE.id:
      return ATTACK_AI_PERSONALITY;
    case DEFENSE_ARCHETYPE.id:
      return DEFENSE_AI_PERSONALITY;
    case STAMINA_ARCHETYPE.id:
      return STAMINA_AI_PERSONALITY;
    default:
      return DEFAULT_AI_PERSONALITY;
  }
}
