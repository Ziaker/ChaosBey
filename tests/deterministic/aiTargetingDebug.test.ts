// ============================================================
// AI TARGETING DEBUG — INTEGRATION (MILESTONE 7 PART 2b)
// Real physics: AIController's debug state keeps the opponent's observed
// position, its predicted position and the aim point apart, all taken from
// the real bodies — and shows no predicted position at all when prediction
// is off (never the current position relabeled). Ported from PR #15 onto
// PR #16's aimPositionXZ.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

async function run(predictionStrength: number) {
  const harness = await CombatHarness.create({ x: -6, y: 0.5, z: 0 }, { x: 0, y: 0.5, z: -6 }, {}, new NullAiMashSource());
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    ATTACK_AI_PERSONALITY,
    { ...DEFAULT_AI_DIFFICULTY_PROFILE, predictionStrength },
    SeededRng.fromSeedText('targeting-debug'),
  );
  // The opponent drives forward, so it has a real velocity to extrapolate.
  const driver = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);
  for (let tick = 0; tick < 45; tick++) harness.tick(driver.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
  // Sample once more and compare with the bodies exactly as the AI saw them.
  const position = harness.first.body.translation();
  const velocity = harness.first.body.linvel();
  ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
  return { debug: ai.getDebugState(), position, velocity };
}

describe('AI targeting debug (M7 Part 2b)', () => {
  it('observed = the real body, predicted = the real extrapolation at the reported horizon, aim between them by the reported strength', async () => {
    const { debug, position, velocity } = await run(0.5);
    expect(Math.hypot(velocity.x, velocity.z), 'the opponent is moving').toBeGreaterThan(0.5);
    expect(debug.observedOpponentXZ.x).toBeCloseTo(position.x, 9);
    expect(debug.observedOpponentXZ.z).toBeCloseTo(position.z, 9);
    expect(debug.predictionStrength).toBe(0.5);
    expect(debug.predictionHorizonS).toBeGreaterThan(0);
    expect(debug.predictedOpponentXZ).not.toBeNull();
    expect(debug.predictedOpponentXZ!.x).toBeCloseTo(position.x + velocity.x * debug.predictionHorizonS, 9);
    expect(debug.predictedOpponentXZ!.z).toBeCloseTo(position.z + velocity.z * debug.predictionHorizonS, 9);
    const gap = Math.hypot(debug.predictedOpponentXZ!.x - debug.observedOpponentXZ.x, debug.predictedOpponentXZ!.z - debug.observedOpponentXZ.z);
    expect(gap, 'the prediction is not the current position').toBeGreaterThan(0.1);
    expect(debug.aimPositionXZ.x).toBeCloseTo(debug.observedOpponentXZ.x + (debug.predictedOpponentXZ!.x - debug.observedOpponentXZ.x) * 0.5, 9);
    expect(debug.aimPositionXZ.z).toBeCloseTo(debug.observedOpponentXZ.z + (debug.predictedOpponentXZ!.z - debug.observedOpponentXZ.z) * 0.5, 9);
    for (const value of [debug.observedOpponentXZ.x, debug.observedOpponentXZ.z, debug.aimPositionXZ.x, debug.aimPositionXZ.z, debug.predictionHorizonS]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('with prediction off (difficulty predictionStrength 0): no predicted position, horizon/strength 0, aim = observed', async () => {
    const { debug, position } = await run(0);
    expect(debug.predictedOpponentXZ).toBeNull();
    expect(debug.predictionHorizonS).toBe(0);
    expect(debug.predictionStrength).toBe(0);
    expect(debug.aimPositionXZ.x).toBeCloseTo(position.x, 9);
    expect(debug.aimPositionXZ.z).toBeCloseTo(position.z, 9);
    expect(debug.aimPositionXZ).toEqual(debug.observedOpponentXZ);
  });
});
