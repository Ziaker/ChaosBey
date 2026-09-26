// ============================================================
// AI DETERMINISM — INTEGRATION TEST (MILESTONE 7)
// GDD section 81: given the same seed + same state + same profile, AI
// behavior must be reproducible. Runs two fully independent Combat
// Harnesses (real Rapier physics, identical setup) driven by an
// AIController seeded from the same text, and requires the exact same
// sequence of ControllerActions from both runs.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import type { ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const TICKS = 240; // 4 simulated seconds — enough to cross several decision/reaction-delay cycles.

async function runOnce(): Promise<ControllerActions[]> {
  const harness = await CombatHarness.create();
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    ATTACK_AI_PERSONALITY,
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText('determinism-fixed-seed'),
  );
  const idle = new IdleController();
  const collected: ControllerActions[] = [];
  for (let i = 0; i < TICKS; i++) {
    const firstActions = idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    collected.push(secondActions);
    harness.tick(firstActions, secondActions);
  }
  return collected;
}

function sortedActionNames(set: ReadonlySet<string>): string[] {
  return Array.from(set).sort();
}

describe('AIController determinism', () => {
  it('produces an identical action sequence across two independent runs with the same seed', async () => {
    const [runA, runB] = await Promise.all([runOnce(), runOnce()]);
    expect(runA.length).toBe(runB.length);
    for (let i = 0; i < runA.length; i++) {
      const a = runA[i]!;
      const b = runB[i]!;
      expect(sortedActionNames(a.held)).toEqual(sortedActionNames(b.held));
      expect(sortedActionNames(a.pressedThisFrame)).toEqual(sortedActionNames(b.pressedThisFrame));
      expect(a.attackHoldDurationSeconds).toBeCloseTo(b.attackHoldDurationSeconds, 9);
      expect(a.jumpDriftHoldDurationSeconds).toBeCloseTo(b.jumpDriftHoldDurationSeconds, 9);
    }
  });
});
