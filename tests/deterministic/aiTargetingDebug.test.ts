// ============================================================
// AI TARGETING DEBUG — INTEGRATION (MILESTONE 7 PART 2b)
// Real physics: AIController's debug state keeps the opponent's observed
// position, the predicted one and the aim point apart, from the real
// bodies — and never shows the current position as a prediction.
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
  // The opponent drives forward so it has a real velocity to extrapolate.
  const driver = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);
  for (let tick = 0; tick < 45; tick++) harness.tick(driver.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
  // Sample once more and compare against the bodies as they are right now.
  const opponentPosition = harness.first.body.translation();
  const opponentVelocity = harness.first.body.linvel();
  ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
  return { debug: ai.getDebugState(), opponentPosition, opponentVelocity };
}

describe('AI targeting debug (M7 Part 2b)', () => {
  it('shows observed = the real body, predicted = the real extrapolation, aim between them, and the steering goal', async () => {
    const { debug, opponentPosition, opponentVelocity } = await run(0.5);
    expect(Math.hypot(opponentVelocity.x, opponentVelocity.z), 'the opponent is moving').toBeGreaterThan(0.5);
    expect(debug.observedOpponentXZ.x).toBeCloseTo(opponentPosition.x, 6);
    expect(debug.observedOpponentXZ.z).toBeCloseTo(opponentPosition.z, 6);
    expect(debug.predictedOpponentXZ).not.toBeNull();
    expect(debug.predictionHorizonS).toBeGreaterThan(0);
    expect(debug.predictionStrength).toBe(0.5);
    expect(debug.predictedOpponentXZ!.x).toBeCloseTo(opponentPosition.x + opponentVelocity.x * debug.predictionHorizonS, 6);
    expect(debug.predictedOpponentXZ!.z).toBeCloseTo(opponentPosition.z + opponentVelocity.z * debug.predictionHorizonS, 6);
    const predictedMinusObserved = Math.hypot(debug.predictedOpponentXZ!.x - debug.observedOpponentXZ.x, debug.predictedOpponentXZ!.z - debug.observedOpponentXZ.z);
    expect(predictedMinusObserved, 'the prediction is not the current position').toBeGreaterThan(0.1);
    expect(debug.aimPointXZ.x).toBeCloseTo((debug.observedOpponentXZ.x + debug.predictedOpponentXZ!.x) / 2, 6);
    expect(debug.aimPointXZ.z).toBeCloseTo((debug.observedOpponentXZ.z + debug.predictedOpponentXZ!.z) / 2, 6);
  });

  it('with prediction off, shows no predicted position at all and aims at the observed one', async () => {
    const { debug, opponentPosition } = await run(0);
    expect(debug.predictedOpponentXZ).toBeNull();
    expect(debug.predictionHorizonS).toBe(0);
    expect(debug.predictionStrength).toBe(0);
    expect(debug.aimPointXZ.x).toBeCloseTo(opponentPosition.x, 6);
    expect(debug.aimPointXZ.z).toBeCloseTo(opponentPosition.z, 6);
  });
});
