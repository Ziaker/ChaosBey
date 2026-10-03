// ============================================================
// AI THROUGH A HITSTOP FREEZE — BOUNDARY TEST (MILESTONE 7 PART 2b)
// Hitstop freezes are applied by main.ts, not tickMatch: while frozen,
// tickMatch() is skipped and every controller is sampled with
// simulationFrozen: true. This reproduces exactly that headlessly and
// checks the boundary "before the hitstop -> freeze -> first tick after":
// - during the freeze the AI repeats its held buttons, presses nothing new,
//   and its hold clocks, reaction timer, intent and late reaction stand still;
// - after the freeze nothing is pressed twice, a Dash charge is not
//   released by accident, commitments survive — in fact the AI's whole
//   action sequence afterwards is IDENTICAL to a control run without the
//   freeze (the freeze is only a pause, never an input).
// Freezes are placed at the moments most likely to break: mid Dash charge,
// during a pending "slow to react" decision, and in a counter stance.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const RUN_TICKS = 600;
/**
 * AI RNG seed whose control run reaches all three freeze situations. Was
 * 'hitstop-freeze'; since the Motion Lab integration (M11) that run never
 * enters a counter stance, so re-swept: -6 reaches them at ticks 28 / 112 / 365.
 * Re-swept for the Dash cooldown (owner, 2026-10-02: no more Attack Energy): -6
 * never reaches a counter stance; -2 is the first of -1..-15 that reaches all three.
 */
const AI_SEED = 'hitstop-freeze-2';
/** ~0.2 s: a strong hit's hitstop. */
const FREEZE_TICKS = 12;
/** How long after the freeze the action sequence must match the control run. */
const COMPARE_TICKS = 120;
/** errorRate 0.35 yields "slow to react" pendings; counterAffinity 1 yields counter stances. */
const PERSONALITY = { ...DEFENSE_AI_PERSONALITY, errorRate: 0.35, counterAffinity: 1, aggression: 0.8 };

interface Sample {
  held: string;
  pressed: string;
  attackHold: number;
  intent: AiIntent;
  pending: AiIntent | null;
  ownAttackState: AttackState;
}

function signature(actions: ControllerActions): { held: string; pressed: string } {
  return { held: [...actions.held].sort().join(','), pressed: [...actions.pressedThisFrame].sort().join(',') };
}

/** Runs the match; if `freezeAtTick` is set, inserts a FREEZE_TICKS hitstop right before that simulated tick. Returns one sample per simulated tick, plus the frozen samples. */
async function run(freezeAtTick: number | null): Promise<{ samples: Sample[]; frozen: { actions: ControllerActions; reactionTimerS: number; pendingDelayRemainingS: number; intent: AiIntent }[]; beforeFreeze: { actions: ControllerActions; reactionTimerS: number; pendingDelayRemainingS: number; intent: AiIntent } | null }> {
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: -4 }, { x: 0, y: 0.5, z: 4 }, {}, new NullAiMashSource());
  const ai = new AIController(harness.physics, harness.second, harness.first, harness.clash.controller, PERSONALITY, DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText(AI_SEED));
  const frames = [];
  for (let start = 10; start < RUN_TICKS; start += 110) {
    frames.push({ fromTick: start, held: [Action.MoveForward, Action.Attack] });
    frames.push({ fromTick: start + 40, held: [Action.MoveForward] });
  }
  const attacker = new ScriptedController(frames);

  const samples: Sample[] = [];
  const frozen: { actions: ControllerActions; reactionTimerS: number; pendingDelayRemainingS: number; intent: AiIntent }[] = [];
  let beforeFreeze: { actions: ControllerActions; reactionTimerS: number; pendingDelayRemainingS: number; intent: AiIntent } | null = null;
  let lastActions: ControllerActions | null = null;

  for (let tick = 0; tick < RUN_TICKS && !harness.roundState.isOver; tick++) {
    if (tick === freezeAtTick && lastActions) {
      const debug = ai.getDebugState();
      beforeFreeze = { actions: lastActions, reactionTimerS: debug.reactionTimerS, pendingDelayRemainingS: debug.pendingDelayRemainingS, intent: debug.activeIntent };
      for (let f = 0; f < FREEZE_TICKS; f++) {
        // As in main.ts: tickMatch is skipped while frozen.
        const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS, simulationFrozen: true });
        const frozenDebug = ai.getDebugState();
        frozen.push({ actions, reactionTimerS: frozenDebug.reactionTimerS, pendingDelayRemainingS: frozenDebug.pendingDelayRemainingS, intent: frozenDebug.activeIntent });
      }
    }
    const firstActions = attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const debug = ai.getDebugState();
    harness.tick(firstActions, actions);
    lastActions = actions;
    samples.push({
      ...signature(actions),
      attackHold: actions.attackHoldDurationSeconds,
      intent: debug.activeIntent,
      pending: debug.pendingIntent,
      ownAttackState: harness.second.attack.getState(),
    });
  }
  return { samples, frozen, beforeFreeze };
}

describe('AI through a hitstop freeze', () => {
  it('pauses cleanly and resumes exactly where it was — mid Dash charge, mid late reaction, in a counter stance', async () => {
    const control = await run(null);

    // Freeze points from the control run: the first tick (after warm-up) of each risky situation.
    const pick = (predicate: (s: Sample) => boolean) => control.samples.findIndex((s, i) => i > 20 && i < RUN_TICKS - COMPARE_TICKS - 1 && predicate(s));
    const freezePoints = {
      midDashCharge: pick((s) => s.ownAttackState === AttackState.ChargingDash && s.held.includes('Attack')),
      pendingLateReaction: pick((s) => s.pending !== null),
      counterStance: pick((s) => s.intent === AiIntent.CounterAttack),
    };
    for (const [name, index] of Object.entries(freezePoints)) expect(index, `control run never reached: ${name}`).toBeGreaterThan(0);

    for (const [name, index] of Object.entries(freezePoints)) {
      // Freeze right before simulated tick index+1, i.e. just after `index` ran.
      const freezeAt = index + 1;
      const frozenRun = await run(freezeAt);
      const before = frozenRun.beforeFreeze!;
      expect(before, name).not.toBeNull();

      // During the freeze: held repeated, nothing new pressed, clocks and decisions still.
      for (const [f, sample] of frozenRun.frozen.entries()) {
        expect(signature(sample.actions).held, `${name} frozen tick ${f}: held`).toBe(signature(before.actions).held);
        expect(sample.actions.pressedThisFrame.size, `${name} frozen tick ${f}: pressed`).toBe(0);
        // The hold clock stands still. (It reads one tick past the last
        // real sample — ActionSelector.repeatFrozenActions reads the tick
        // counter commit() already advanced — harmless: tickMatch does not
        // run while frozen, so nothing consumes it, and the first real tick
        // afterwards matches the control run exactly, asserted below.)
        expect(sample.actions.attackHoldDurationSeconds, `${name} frozen tick ${f}: attack hold clock`).toBe(frozenRun.frozen[0]!.actions.attackHoldDurationSeconds);
        expect(sample.actions.attackHoldDurationSeconds - before.actions.attackHoldDurationSeconds).toBeLessThanOrEqual(FIXED_DELTA_SECONDS + 1e-9);
        expect(sample.reactionTimerS, `${name} frozen tick ${f}: reaction timer`).toBe(before.reactionTimerS);
        expect(sample.pendingDelayRemainingS, `${name} frozen tick ${f}: late-reaction clock`).toBe(before.pendingDelayRemainingS);
        expect(sample.intent, `${name} frozen tick ${f}: intent`).toBe(before.intent);
      }

      // After the freeze: identical to the control run, tick for tick.
      for (let t = freezeAt; t < freezeAt + COMPARE_TICKS && t < control.samples.length; t++) {
        const got = frozenRun.samples[t]!;
        const want = control.samples[t]!;
        expect(got, `${name}: tick ${t - freezeAt} after the freeze`).toEqual(want);
      }
      // First post-freeze tick specifically: nothing already held is pressed again.
      const firstAfter = frozenRun.samples[freezeAt]!;
      for (const action of firstAfter.pressed.split(',').filter(Boolean)) {
        expect(before.actions.held.has(action as Action), `${name}: ${action} pressed twice across the freeze`).toBe(false);
      }
    }
  }, 60000);
});
