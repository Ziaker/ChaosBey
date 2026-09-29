// ============================================================
// AI EXPLANATION — WHAT THE OPPONENT CAN DO, IN PLAIN WORDS (M10)
// The Pregame screen explains the chosen AI from the same numbers the
// AIController plays with: the personality (its style) and the difficulty
// tier (its skill). Each capability is the effective value the AI uses
// (personality × tier), shown as a bar and a short readout. Nothing here
// changes the AI.
// ============================================================

import { applyDifficultyTraits, type AiDifficultyProfile } from '../../ai/difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../../ai/personalities/AiPersonality';
import type { AiPersonalityChoice } from '../session/SideControllers';

export interface AiCapability {
  readonly key: 'reaction' | 'prediction' | 'consistency' | 'evasion' | 'arenaAwareness' | 'clash' | 'adaptation';
  readonly label: string;
  /** 0..1 for the bar: longer = stronger opponent. */
  readonly score: number;
  /** Short readout of the real value, e.g. "0.12 s". */
  readonly readout: string;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Bar scales: fixed, so the same bar length means the same value on every screen. */
const REACTION_BEST_S = 0.05;
const REACTION_WORST_S = 0.45;
const ERROR_RATE_WORST = 0.3;
const EDGE_CAUTION_MIN = 0.8;
const EDGE_CAUTION_MAX = 1.8;
const CLASH_MASH_MAX_PER_S = 8;

export function aiCapabilities(personality: AiPersonality, difficulty: AiDifficultyProfile): readonly AiCapability[] {
  const played = applyDifficultyTraits(personality, difficulty);
  const reactionS = Math.max(0, personality.reactionDelaySeconds * difficulty.reactionDelayMultiplier);
  const errorRate = clamp01(personality.errorRate * difficulty.errorRateMultiplier);
  const adaptation = clamp01(personality.adaptationRate * difficulty.adaptationMultiplier);
  const mashPerS = Math.max(0, personality.clashMashRatePerSecond * difficulty.clashMashRateMultiplier);
  return [
    {
      key: 'reaction',
      label: 'Reaction',
      score: clamp01((REACTION_WORST_S - reactionS) / (REACTION_WORST_S - REACTION_BEST_S)),
      readout: `${reactionS.toFixed(2)} s`,
    },
    {
      key: 'prediction',
      label: 'Prediction',
      score: clamp01(difficulty.predictionStrength),
      readout: difficulty.predictionStrength < 0.3 ? 'reacts to where you are' : difficulty.predictionStrength < 0.7 ? 'leads you a little' : 'aims where you are going',
    },
    {
      key: 'consistency',
      label: 'Consistency',
      score: clamp01(1 - errorRate / ERROR_RATE_WORST),
      readout: `hesitates on ${Math.round(errorRate * 100)}% of decisions`,
    },
    {
      key: 'evasion',
      label: 'Evasion',
      score: played.dodgeSkill,
      readout: `dodges ${Math.round(played.dodgeSkill * 100)}% of threats in time`,
    },
    {
      key: 'arenaAwareness',
      label: 'Arena awareness',
      score: clamp01((played.edgeCautionMultiplier - EDGE_CAUTION_MIN) / (EDGE_CAUTION_MAX - EDGE_CAUTION_MIN)),
      readout: played.edgeCautionMultiplier >= 1.25 ? 'stays well clear of the edge' : played.edgeCautionMultiplier >= 1.1 ? 'minds the edge' : 'takes risks near the edge',
    },
    {
      key: 'clash',
      label: 'Clash power',
      score: clamp01(mashPerS / CLASH_MASH_MAX_PER_S),
      readout: `${mashPerS.toFixed(1)} presses/s`,
    },
    {
      key: 'adaptation',
      label: 'Adaptation',
      score: adaptation,
      readout: adaptation === 0 ? 'never adapts' : adaptation < 0.4 ? 'slowly learns your habits' : 'quickly learns your habits',
    },
  ];
}

/** How the AI likes to fight (its personality), as short sentences. Always at least one. */
export function aiStyleLines(personality: AiPersonality): readonly string[] {
  const lines: string[] = [];
  if (personality.aggression >= 0.7) lines.push('Presses forward and commits to Dash attacks early.');
  if (personality.edgePressureAffinity >= 0.7) lines.push('Pushes you toward the edge for a ring-out.');
  if (personality.caution >= 0.7) lines.push('Keeps its distance and waits for you to commit.');
  if (personality.counterAffinity >= 0.7) lines.push('Answers a Dash attack with a Circular counter.');
  if (personality.centerControl >= 0.7) lines.push('Holds the centre of the arena.');
  if (personality.collisionAvoidance >= 0.6) lines.push('Avoids heavy collisions.');
  if (personality.fatigueExploitation >= 0.7) lines.push('Strikes when your Stamina runs low.');
  lines.push(`Resource use: ${resourceUse(personality)}.`);
  return lines;
}

function resourceUse(personality: AiPersonality): string {
  const thrift = (personality.patience + personality.dodgeThrift) / 2;
  if (thrift >= 0.6) return 'thrifty, steps aside instead of spending Stamina on a dodge';
  if (thrift <= 0.25) return 'spends Stamina freely on attacks and dodges';
  return 'balanced';
}

export const AI_STYLE_LABELS: Readonly<Record<AiPersonalityChoice, string>> = {
  archetype: 'Matches its Bey',
  attack: 'Aggressor',
  defense: 'Counter-puncher',
  stamina: 'Endurance',
};
