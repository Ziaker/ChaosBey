// ============================================================
// AI TACTICS — INTEGRATION TESTS (MILESTONE 7 PART 2)
// Real physics + real tickMatch(), driven through the same CombatController
// interface a player uses. Each test pins one Part 2 behavior with a fixed
// seed so it is reproducible (GDD section 68/81).
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import type { AiPersonality } from '../../src/ai/personalities/AiPersonality';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action, type CombatController } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

type Spawn = { x: number; y: number; z: number };

/** Harness with `second` driven by a real AIController and `first` by the given controller. */
async function aiVersus(firstSpawn: Spawn, aiSpawn: Spawn, personality: AiPersonality, seed: string) {
  const harness = await CombatHarness.create(firstSpawn, aiSpawn, {}, new NullAiMashSource());
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    personality,
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText(seed),
  );
  const step = (first: CombatController) =>
    harness.tick(first.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
  return { harness, ai, step };
}

describe('AI tactics (M7 Part 2)', () => {
  it('answers a telegraphed Dash with a timed Circular counter that catches the dasher', async () => {
    // Scripted dasher: charge ~0.6 s, release, recover, repeat — straight at the AI.
    const frames = [];
    for (let start = 30; start < 900; start += 150) {
      frames.push({ fromTick: start, held: [Action.Attack] });
      frames.push({ fromTick: start + 36, held: [] });
    }
    const dasher = new ScriptedController(frames);
    const alwaysCounters = { ...DEFENSE_AI_PERSONALITY, counterAffinity: 1 };
    const { harness, step } = await aiVersus({ x: 0, y: 0.5, z: -3 }, { x: 0, y: 0.5, z: 3 }, alwaysCounters, 'counter-read');

    let caughtDasher = false;
    for (let i = 0; i < 900 && !harness.roundState.isOver && !caughtDasher; i++) {
      const result = step(dasher);
      caughtDasher = result.hitEvents.some((hit) => !hit.attackerIsFirst && hit.caughtOpponentDashing);
    }
    expect(caughtDasher).toBe(true);
  });

  it('presses an opponent near the edge from the center side: it does not start an attack from the flank', async () => {
    const idle = new IdleController();
    // Idle opponent parked against the +X wall; the AI starts on its flank,
    // where attacking straight away would push it along the wall (outward
    // cosine ~0.23), not out of the ring. Without center-side positioning
    // the AI starts charging a Dash right there on tick 0.
    const { harness, step } = await aiVersus({ x: 11.2, y: 0.5, z: 0 }, { x: 10, y: 0.5, z: 5 }, ATTACK_AI_PERSONALITY, 'edge-pressure');

    let outwardAtFirstAttack: number | null = null;
    let firstHitTick: number | null = null;
    for (let i = 0; i < 6 * 60 && !harness.roundState.isOver && firstHitTick === null; i++) {
      const result = step(idle);
      if (outwardAtFirstAttack === null && harness.second.attack.getState() !== AttackState.Neutral) {
        const own = harness.second.body.translation();
        const target = harness.first.body.translation();
        const toTarget = { x: target.x - own.x, z: target.z - own.z };
        // How much the push direction (attacker -> defender) points away from the center.
        outwardAtFirstAttack = (toTarget.x * target.x + toTarget.z * target.z) / (Math.hypot(toTarget.x, toTarget.z) * Math.hypot(target.x, target.z));
      }
      if (result.hitEvents.some((h) => !h.attackerIsFirst)) firstHitTick = i;
    }
    expect(outwardAtFirstAttack).not.toBeNull();
    expect(outwardAtFirstAttack!).toBeGreaterThan(0.5);
    expect(firstHitTick, 'the positioning must still end in a real hit, not endless circling').not.toBeNull();
  });

  it('backs away from the edge in reverse when it starts facing out of the ring, and keeps going until clear', async () => {
    const idle = new IdleController();
    // AI spawned at z=11 facing +Z (heading 0) = straight at the boundary.
    const { harness, ai, step } = await aiVersus({ x: 0, y: 0.5, z: -6 }, { x: 0, y: 0.5, z: 11 }, DEFENSE_AI_PERSONALITY, 'edge-reverse');
    let reversedTowardCenter = false;
    for (let i = 0; i < 150; i++) {
      step(idle);
      const facingOut = Math.cos(harness.second.movement.getHeadingRad()) > 0.7;
      if (facingOut && harness.second.body.linvel().z < -0.5) reversedTowardCenter = true;
      expect(harness.roundState.isOver).toBe(false);
    }
    const t = harness.second.body.translation();
    expect(reversedTowardCenter).toBe(true);
    // Recovery released only once clear of the override zone (hysteresis).
    expect(Math.hypot(t.x, t.z)).toBeLessThan(10.5);
    expect(ai.getDebugState().edgeRiskFraction).toBeLessThan(0.55);
  });
});
