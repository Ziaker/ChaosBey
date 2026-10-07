// ============================================================
// AI AIR RECOVERY — SHORT-WINDOW TIMING (MILESTONE 7 PART 2b)
// Real physics + real tickMatch(). A controlled launch (registerLaunch +
// an upward velocity, exactly what tickMatch does on a real hit) gives the
// AI an air-recovery window of a chosen length, bracketing its reaction
// delay on both sides. Pins the timing chain as implemented in PR #16:
//
//   launch -> window seen open at tick W0 (airborne + armed)
//          -> the reaction timer restarts at W0 (launch interrupts any
//             commitment / pending late reaction)
//          -> AirRecover decided and Dodge pressed at W0 + ceil(R/dt) - 1
//          -> recovery applied once, only if the window is still open.
//
// So an AI with reaction delay R recovers a window only if it stays open
// at least ceil(R/dt) ticks; a shorter window is always lost. This test
// CHARACTERIZES that rule (it does not decide whether it is desirable —
// see the M7 Part 2b report). In every case Dodge is never pressed outside
// the window, and never on the ground afterwards.
// ============================================================

import { describe, expect, it, vi } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import type { AiPersonality } from '../../src/ai/personalities/AiPersonality';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

interface Timeline {
  /** Ticks (after the launch) on which the window was open as the AI sampled. */
  windowTicks: number[];
  pressTicks: number[];
  /** Dodge presses made while grounded after the launch — must never happen here. */
  groundPressTicks: number[];
  airRecoverDecisionTick: number | null;
  recoveriesApplied: number;
}

async function launch(personality: AiPersonality, upwardSpeedMps: number): Promise<Timeline> {
  // Opponent idle and far away: nothing else to react to.
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: -9 }, { x: 0, y: 0.5, z: 0 }, {}, new NullAiMashSource());
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    { ...personality, errorRate: 0 },
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText('air-recovery-timing'),
  );
  const airRecovery = vi.spyOn(harness.second.spin, 'applyAirRecovery');
  const idle = new IdleController();
  const step = () => harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
  for (let i = 0; i < 40; i++) step(); // settle on the floor

  expect(isGrounded(harness.physics, harness.second.collider), 'launched from the ground').toBe(true);
  harness.second.dodge.registerLaunch(false);
  const velocity = harness.second.body.linvel();
  harness.second.body.setLinvel({ x: velocity.x, y: upwardSpeedMps, z: velocity.z }, true);

  const timeline: Timeline = { windowTicks: [], pressTicks: [], groundPressTicks: [], airRecoverDecisionTick: null, recoveriesApplied: 0 };
  for (let tick = 0; tick < 90; tick++) {
    const grounded = isGrounded(harness.physics, harness.second.collider);
    const windowOpen = !grounded && harness.second.dodge.isAirRecoveryAvailable();
    const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const debug = ai.getDebugState();
    harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), actions);
    if (windowOpen) timeline.windowTicks.push(tick);
    if (actions.pressedThisFrame.has(Action.Dodge)) (grounded ? timeline.groundPressTicks : timeline.pressTicks).push(tick);
    if (timeline.airRecoverDecisionTick === null && debug.activeIntent === AiIntent.AirRecover) timeline.airRecoverDecisionTick = tick;
  }
  timeline.recoveriesApplied = airRecovery.mock.calls.length;
  return timeline;
}

/** Ticks from the window opening (inclusive) to the reaction: the timer restarts at the opening tick and must reach R. */
function reactionTicks(personality: AiPersonality): number {
  return Math.ceil(personality.reactionDelaySeconds * DEFAULT_AI_DIFFICULTY_PROFILE.reactionDelayMultiplier / FIXED_DELTA_SECONDS - 1e-9);
}

describe('AI air recovery — short window vs reaction delay (M7 Part 2b)', () => {
  // [personality, launch speed giving a window just SHORTER than its reaction, one comfortably LONGER]
  for (const [personality, shortV, longV] of [
    // Defense re-picked in the owner audit (2026-10-04): at 1.2 m/s the window now closes one tick before the 10-tick
    // reaction (open ticks 3–11); 1.4 m/s opens it on tick 2 and keeps it to 11. The reaction timing itself is unchanged.
    [DEFENSE_AI_PERSONALITY, 1.2, 1.4],
    [ATTACK_AI_PERSONALITY, 1.3, 1.7],
  ] as const) {
    const needed = reactionTicks(personality);

    it(`${personality.id} (reaction ${personality.reactionDelaySeconds}s = ${needed} ticks): a longer window is recovered exactly ${needed} ticks after it opens`, async () => {
      const t = await launch(personality, longV);
      const opened = t.windowTicks[0]!;
      // ≤ 5 since the Motion Lab integration (M11): the floor contact of the
      // launched Defense Bey now clears one tick later (tick 5 for every
      // launch speed from 1.1 to 1.4 m/s; was ≤ 4). The reaction timing
      // asserted below is exact and unchanged.
      expect(opened, 'the launch opened a window within a few ticks').toBeLessThanOrEqual(5);
      expect(t.pressTicks, 'one press').toHaveLength(1);
      expect(t.pressTicks[0], 'pressed at opening + reaction').toBe(opened + needed - 1);
      expect(t.airRecoverDecisionTick).toBe(t.pressTicks[0]);
      expect(t.windowTicks, 'the window was open on the press tick').toContain(t.pressTicks[0]);
      expect(t.recoveriesApplied).toBe(1);
      expect(t.groundPressTicks).toEqual([]);
    });

    it(`${personality.id}: a window shorter than ${needed} ticks is always lost — no press in the air, none on the ground after`, async () => {
      const t = await launch(personality, shortV);
      expect(t.windowTicks.length, 'a real (armed, airborne) window happened').toBeGreaterThan(0);
      expect(t.windowTicks.length, 'shorter than the reaction').toBeLessThan(needed);
      expect(t.pressTicks).toEqual([]);
      expect(t.groundPressTicks).toEqual([]);
      expect(t.recoveriesApplied).toBe(0);
    });
  }
});
