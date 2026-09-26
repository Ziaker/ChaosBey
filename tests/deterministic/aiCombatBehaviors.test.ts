// ============================================================
// AI COMBAT BEHAVIORS — INTEGRATION TESTS (MILESTONE 7)
// GDD section 62-65: the AI must be able to land an attack, and to answer
// a real incoming threat with a dodge, through the same real physics/
// hit-detection/dodge pipeline every other controller uses.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { DodgeState } from '../../src/dodge/DodgeController';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { Action } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

describe('AI combat behaviors', () => {
  it('can land a hit on a stationary opponent', async () => {
    // Spawned close together so an aggressive personality reaches Circular
    // Attack range quickly and reliably within the tick budget below.
    const harness = await CombatHarness.create({ x: 0, y: 0.6, z: -1.5 }, { x: 0, y: 0.6, z: 1.5 });
    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      ATTACK_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('ai-can-attack-seed'),
    );
    const idle = new IdleController();

    let landedAHit = false;
    for (let i = 0; i < 600 && !landedAHit; i++) {
      const firstActions = idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const result = harness.tick(firstActions, secondActions);
      if (result.hitEvents.some((h) => !h.attackerIsFirst)) landedAHit = true;
    }

    expect(landedAHit).toBe(true);
  });

  it('dodges (or is protected by dodge i-frames from) a repeatedly telegraphed attack', async () => {
    const harness = await CombatHarness.create({ x: 0, y: 0.6, z: -1.8 }, { x: 0, y: 0.6, z: 1.8 });
    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      DEFENSE_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('ai-can-dodge-seed'),
    );

    // A crude but repeatedly-threatening attacker: holds Attack (charging a
    // Dash) for a while, releases, and repeats — giving the AI many
    // separate "imminent hitbox" windows to react to over the run.
    const frames = [];
    for (let cycleStart = 0; cycleStart < 900; cycleStart += 90) {
      frames.push({ fromTick: cycleStart, held: [Action.MoveForward, Action.Attack] });
      frames.push({ fromTick: cycleStart + 45, held: [Action.MoveForward] });
    }
    const attacker = new ScriptedController(frames);

    let dodgedAtLeastOnce = false;
    for (let i = 0; i < 900; i++) {
      const firstActions = attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const result = harness.tick(firstActions, secondActions);
      if (harness.second.dodge.getState() === DodgeState.Dodging) dodgedAtLeastOnce = true;
      if (result.combatEvents.some((e) => e.kind === 'dodged' && e.targetIsFirst === false)) dodgedAtLeastOnce = true;
    }

    expect(dodgedAtLeastOnce).toBe(true);
  });
});
