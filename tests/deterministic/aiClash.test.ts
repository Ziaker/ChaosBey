// ============================================================
// AI CLASH PARTICIPATION — INTEGRATION TEST (MILESTONE 7)
// GDD section 42/152: "AI participates in Clash ... Its controller can
// produce the same abstract Clash input action as a player controller."
// Forces a real Clash Active state via ClashController's own public API
// (the exact same state tickMatch() drives it through), then verifies the
// AI's real Z/X/C presses (not a literal event-synthesis backdoor) are
// what ClashController.tick() actually counts as mash events.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ClashState, type ClashCombatantInputTick } from '../../src/combat/clash/ClashController';
import { buildMashActionSet } from '../../src/app/simulation/ClashOrchestration';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

describe('AI Clash participation', () => {
  it('contributes real mash events to ClashController while Active', async () => {
    const harness = await CombatHarness.create();
    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      ATTACK_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('ai-clash-mash-seed'),
    );

    const started = harness.clash.controller.tryStart({
      firstStaminaFraction: 1,
      secondStaminaFraction: 1,
      firstSpeedMps: 3,
      secondSpeedMps: 3,
    });
    expect(started).toBe(true);
    expect(harness.clash.controller.getState()).toBe(ClashState.Active);

    const noInput: ClashCombatantInputTick = { pressedActionIds: new Set(), aiMashEventThisTick: false };

    for (let i = 0; i < 240 && harness.clash.controller.getState() === ClashState.Active; i++) {
      const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondInput: ClashCombatantInputTick = { pressedActionIds: buildMashActionSet(secondActions), aiMashEventThisTick: false };
      harness.clash.controller.tick(FIXED_DELTA_SECONDS, noInput, secondInput);
    }

    // Either the AI mashed enough to already have resolved the Clash (a
    // real, meaningful ClashPower contribution), or it's still Active with
    // a positive running mash count — both are proof the AI's real presses
    // reached ClashController through the normal per-combatant channel.
    if (harness.clash.controller.getState() === ClashState.Active) {
      expect(harness.clash.controller.getSecondMashEventCount()).toBeGreaterThan(0);
    } else {
      const result = harness.clash.controller.getLastResult();
      expect(result).not.toBeNull();
      expect(result!.secondMashEventCount).toBeGreaterThan(0);
    }
  });
});
