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
import { ClashController, ClashState, type ClashCombatantInputTick } from '../../src/combat/clash/ClashController';
import { FixedIntervalAiMashSource, NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { CLASH_AI_MASH_INTERVAL_TICKS } from '../../src/combat/clash/ClashTuning';
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

  it('regression: NullAiMashSource must be used for a real AIController opponent — the Milestone 5 placeholder alone can double-count on top of its real presses', async () => {
    // Capture the AI's own real per-tick Z/X/C press sets deterministically
    // (independent of any mash-source choice — this is just what the AI
    // itself presses through the normal ControllerActions channel).
    const harness = await CombatHarness.create();
    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      ATTACK_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('mash-dedup-regression-seed'),
    );
    harness.clash.controller.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 3, secondSpeedMps: 3 });
    const pressedActionSets: ReadonlySet<string>[] = [];
    for (let i = 0; i < 150; i++) {
      const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      pressedActionSets.push(buildMashActionSet(secondActions));
    }

    // Replays that exact captured sequence against a fresh ClashController,
    // once through each mash-source choice, so the only variable is
    // whether the Milestone 5 placeholder is layered on top.
    function replayAndCountSecondMashEvents(useFixedIntervalPlaceholder: boolean): number {
      const controller = new ClashController();
      controller.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 3, secondSpeedMps: 3 });
      const placeholder = useFixedIntervalPlaceholder ? new FixedIntervalAiMashSource(CLASH_AI_MASH_INTERVAL_TICKS) : new NullAiMashSource();
      const noInput: ClashCombatantInputTick = { pressedActionIds: new Set(), aiMashEventThisTick: false };
      for (let i = 0; i < pressedActionSets.length && controller.getState() === ClashState.Active; i++) {
        const secondInput: ClashCombatantInputTick = {
          pressedActionIds: pressedActionSets[i]!,
          aiMashEventThisTick: placeholder.sampleTick(i, controller.getElapsedS()),
        };
        controller.tick(FIXED_DELTA_SECONDS, noInput, secondInput);
      }
      return controller.getState() === ClashState.Active ? controller.getSecondMashEventCount() : (controller.getLastResult()?.secondMashEventCount ?? 0);
    }

    const withPlaceholderLeftActive = replayAndCountSecondMashEvents(true);
    const withNullMashSource = replayAndCountSecondMashEvents(false);

    // The placeholder can only ever add events on top of the AI's real
    // presses (nextMashEventCount takes either source, so an overlap never
    // subtracts) — proving the double-count risk the review flagged.
    expect(withPlaceholderLeftActive).toBeGreaterThanOrEqual(withNullMashSource);
    // And on this captured sequence it actually does add at least one —
    // otherwise this regression would be vacuous.
    expect(withPlaceholderLeftActive).toBeGreaterThan(withNullMashSource);
  });
});
