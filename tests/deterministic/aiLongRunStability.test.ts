// ============================================================
// AI LONG-RUN STABILITY + CONTRACT — INTEGRATION TEST (MILESTONE 7)
// GDD section 67/162: AI vs AI is required for long-run stability testing.
// Two AIControllers (different archetype personalities) drive a full match
// for many ticks; every tick's output must satisfy CombatController's
// contract and no physics/resource value may ever become non-finite.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const MAX_TICKS = 4000; // ~66 simulated seconds — generous room for a round to resolve.

function assertValidControllerContract(actions: ControllerActions, label: string): void {
  expect(actions.held, `${label}: held must be a Set`).toBeInstanceOf(Set);
  expect(actions.pressedThisFrame, `${label}: pressedThisFrame must be a Set`).toBeInstanceOf(Set);
  for (const action of actions.pressedThisFrame) {
    expect(Object.values(Action)).toContain(action);
    expect(actions.held.has(action), `${label}: pressedThisFrame entry must also be in held`).toBe(true);
  }
  for (const action of actions.held) {
    expect(Object.values(Action)).toContain(action);
  }
  expect(Number.isFinite(actions.attackHoldDurationSeconds), `${label}: attackHoldDurationSeconds finite`).toBe(true);
  expect(actions.attackHoldDurationSeconds).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(actions.jumpDriftHoldDurationSeconds), `${label}: jumpDriftHoldDurationSeconds finite`).toBe(true);
  expect(actions.jumpDriftHoldDurationSeconds).toBeGreaterThanOrEqual(0);
}

function assertFiniteFraction(value: number, label: string): void {
  expect(Number.isFinite(value), `${label} must be finite`).toBe(true);
  expect(value).toBeGreaterThanOrEqual(-1e-6);
  expect(value).toBeLessThanOrEqual(1 + 1e-6);
}

describe('AI vs AI long-run stability', () => {
  it('runs a full match for thousands of ticks with a valid controller contract and no invalid/NaN state throughout', async () => {
    const harness = await CombatHarness.create();
    const firstAi = new AIController(
      harness.physics,
      harness.first,
      harness.second,
      harness.clash.controller,
      ATTACK_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('long-run-first'),
    );
    const secondAi = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      DEFENSE_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('long-run-second'),
    );

    let roundEndedTick: number | null = null;

    for (let i = 0; i < MAX_TICKS; i++) {
      const firstActions = firstAi.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondActions = secondAi.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      assertValidControllerContract(firstActions, `first tick ${i}`);
      assertValidControllerContract(secondActions, `second tick ${i}`);

      const result = harness.tick(firstActions, secondActions);

      for (const [label, snapshot] of [
        ['first', result.first],
        ['second', result.second],
      ] as const) {
        assertFiniteFraction(snapshot.staminaFraction, `${label} tick ${i} staminaFraction`);
        assertFiniteFraction(snapshot.stabilityFraction, `${label} tick ${i} stabilityFraction`);
        assertFiniteFraction(snapshot.attackEnergyFraction, `${label} tick ${i} attackEnergyFraction`);
        assertFiniteFraction(snapshot.dashChargeFraction, `${label} tick ${i} dashChargeFraction`);
        expect(Number.isFinite(snapshot.spin.angularVelocity.x), `${label} tick ${i} angularVelocity.x finite`).toBe(true);
        expect(Number.isFinite(snapshot.spin.angularVelocity.y), `${label} tick ${i} angularVelocity.y finite`).toBe(true);
        expect(Number.isFinite(snapshot.spin.angularVelocity.z), `${label} tick ${i} angularVelocity.z finite`).toBe(true);
        expect(Number.isFinite(snapshot.movement.speedMps), `${label} tick ${i} speedMps finite`).toBe(true);
      }

      const firstT = harness.first.body.translation();
      const secondT = harness.second.body.translation();
      for (const t of [firstT, secondT]) {
        expect(Number.isFinite(t.x)).toBe(true);
        expect(Number.isFinite(t.y)).toBe(true);
        expect(Number.isFinite(t.z)).toBe(true);
      }

      if (harness.roundState.isOver && roundEndedTick === null) {
        roundEndedTick = i;
        break;
      }
    }

    expect(roundEndedTick, 'a round between two AI vs AI opponents should resolve within the tick budget').not.toBeNull();
  }, 60000);
});
