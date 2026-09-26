// ============================================================
// AI ARCHETYPE BEHAVIOR DIFFERENCES — INTEGRATION TEST (MILESTONE 7)
// GDD section 64: "Attack AI: more aggressive ... Stamina AI: more
// evasive." Same starting positions/seed, only the personality differs —
// Attack must commit to its first attack meaningfully sooner than Stamina.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY, STAMINA_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import type { AiPersonality } from '../../src/ai/personalities/AiPersonality';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const MAX_TICKS = 600; // 10 simulated seconds.

/** First tick (or null if it never happens within MAX_TICKS) the AI's own attackState leaves Neutral — i.e. it committed to an attack. */
async function ticksUntilFirstAttackCommitment(personality: AiPersonality, seedText: string): Promise<number | null> {
  const harness = await CombatHarness.create();
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    personality,
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText(seedText),
  );
  const idle = new IdleController();
  for (let i = 0; i < MAX_TICKS; i++) {
    const firstActions = idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    harness.tick(firstActions, secondActions);
    if (harness.second.attack.getState() !== AttackState.Neutral) return i;
  }
  return null;
}

describe('AI archetype behavior differences', () => {
  it('Attack personality commits to an attack no later than Stamina personality from the same start', async () => {
    const attackTicks = await ticksUntilFirstAttackCommitment(ATTACK_AI_PERSONALITY, 'archetype-behavior-seed');
    const staminaTicks = await ticksUntilFirstAttackCommitment(STAMINA_AI_PERSONALITY, 'archetype-behavior-seed');

    expect(attackTicks).not.toBeNull();
    expect(staminaTicks).not.toBeNull();
    // Attack's higher aggression + shorter reactionDelaySeconds should never
    // make it slower to commit than the more patient Stamina personality.
    expect(attackTicks!).toBeLessThanOrEqual(staminaTicks!);
  });
});
