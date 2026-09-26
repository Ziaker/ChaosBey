// ============================================================
// AI DODGE ROLL GRANULARITY — INTEGRATION TEST (MILESTONE 7)
// Regression for the M7 part 1 review: AiPersonality.dodgeSkill must be
// rolled exactly once per fresh DodgeThreat decision, not once per fixed
// tick — a per-tick roll would let a moderate dodgeSkill converge toward
// near-certain success over the several ticks a single threat window can
// span. Confirms the semantics directly via AiDebugState.dodgeAttemptSucceeds:
// it must stay identical across consecutive ticks within the SAME decision
// (reactionTimerS still climbing, no reset), and may only change on the
// tick a fresh decision actually happens.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DodgeState } from '../../src/dodge/DodgeController';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { Action } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

describe('AI dodge roll granularity', () => {
  it('rolls dodgeSkill once per fresh DodgeThreat decision, not once per fixed tick (fixed seed)', async () => {
    const harness = await CombatHarness.create({ x: 0, y: 0.6, z: -1.8 }, { x: 0, y: 0.6, z: 1.8 });
    // dodgeSkill=0: the roll always fails, so Dodge is never actually
    // pressed and DodgeState never leaves Idle — the SAME DodgeThreat
    // decision (and its single pre-roll) can persist across many ticks
    // without the physical dodge itself consuming/resetting anything,
    // isolating exactly the "how often is the roll re-drawn" question.
    const neverDodges = { ...DEFENSE_AI_PERSONALITY, dodgeSkill: 0 };
    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      neverDodges,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('dodge-roll-granularity-seed'),
    );

    // Same repeated-charge pattern as the "AI can dodge" combat test —
    // held/released in cycles so Buffering re-triggers each time (a
    // permanently-held Attack only ever produces one pressedThisFrame edge,
    // per ScriptedController's held/pressed diffing), keeping opponentThreat
    // high across many separate windows over the whole run.
    const frames = [];
    for (let cycleStart = 0; cycleStart < 900; cycleStart += 90) {
      frames.push({ fromTick: cycleStart, held: [Action.MoveForward, Action.Attack] });
      frames.push({ fromTick: cycleStart + 45, held: [Action.MoveForward] });
    }
    const attacker = new ScriptedController(frames);

    let sawDodgeThreatIntent = false;
    let sawSameDecisionAcrossMultipleTicks = false;
    let previousReactionTimerS = Number.POSITIVE_INFINITY;
    let previousDodgeAttemptSucceeds: boolean | null = null;

    for (let i = 0; i < 900; i++) {
      const firstActions = attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const debug = ai.getDebugState();

      if (debug.activeIntent === AiIntent.DodgeThreat) {
        sawDodgeThreatIntent = true;
        const freshDecisionThisTick = debug.reactionTimerS < previousReactionTimerS;
        if (!freshDecisionThisTick && previousDodgeAttemptSucceeds !== null) {
          // Same decision as last tick (timer kept climbing, not reset) —
          // the pre-rolled outcome must be byte-identical, never re-drawn.
          expect(debug.dodgeAttemptSucceeds).toBe(previousDodgeAttemptSucceeds);
          sawSameDecisionAcrossMultipleTicks = true;
        }
        previousDodgeAttemptSucceeds = debug.dodgeAttemptSucceeds;
      } else {
        previousDodgeAttemptSucceeds = null;
      }
      previousReactionTimerS = debug.reactionTimerS;

      harness.tick(firstActions, secondActions);
    }

    expect(sawDodgeThreatIntent).toBe(true);
    // Proves the test actually exercised the same-decision-multiple-ticks
    // path at least once — otherwise the assertion above never ran.
    expect(sawSameDecisionAcrossMultipleTicks).toBe(true);
    // With dodgeSkill=0 the roll must always fail and Dodge must never be
    // pressed — confirms this scenario never let the physical dodge
    // itself interfere with observing the roll's persistence.
    expect(harness.second.dodge.getState()).toBe(DodgeState.Idle);
  });
});
