// ============================================================
// AIR RECOVERY — NO PHANTOM WINDOW AFTER AN UNUSED LAUNCH (M7 PART 2b)
// Regression (source-semantics audit, M7 Part 2b final): DodgeController
// keeps its air-recovery flag after landing when the recovery was not used;
// it is only overwritten at the next takeoff, INSIDE that takeoff tick.
// DodgeController.isAirRecoveryAvailable() used to return that raw flag, so
// on the first airborne tick of a later plain hop (no launch) it read true
// while airborne — the AI took it for a fresh launch (reset its reaction
// timer, dropped any pending late reaction) although a Dodge press on that
// very tick recovers nothing. The getter now means "armed for the CURRENT
// airborne period" (armed AND already airborne on the previous tick).
// ============================================================

import { describe, expect, it, vi } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const DODGE_PRESS: ControllerActions = {
  held: new Set([Action.Dodge]),
  pressedThisFrame: new Set([Action.Dodge]),
  attackHoldDurationSeconds: 0,
  jumpDriftHoldDurationSeconds: 0,
};

/** Settle, launch too briefly for the AI to react (8-tick window vs a 10-tick reaction), land, then start a plain hop with no launch. */
async function unusedLaunchThenPlainHop() {
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: -9 }, { x: 0, y: 0.5, z: 0 }, {}, new NullAiMashSource());
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    { ...DEFENSE_AI_PERSONALITY, errorRate: 0 },
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText('air-recovery-phantom'),
  );
  const idle = new IdleController();
  const step = (second?: ControllerActions) =>
    harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), second ?? ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
  for (let i = 0; i < 40; i++) step();
  harness.second.dodge.registerLaunch(false);
  let velocity = harness.second.body.linvel();
  harness.second.body.setLinvel({ x: velocity.x, y: 1.0, z: velocity.z }, true);
  for (let i = 0; i < 30; i++) step();
  expect(isGrounded(harness.physics, harness.second.collider), 'landed after the unused launch').toBe(true);
  // A plain hop: an upward push with NO registerLaunch (a bounce or a normal jump).
  velocity = harness.second.body.linvel();
  harness.second.body.setLinvel({ x: velocity.x, y: 1.5, z: velocity.z }, true);
  return { harness, ai, step };
}

describe('air recovery availability after an unused launch (M7 Part 2b regression)', () => {
  it('a later plain hop never reads as an open window, and the AI does not treat it as a launch', async () => {
    const { harness, ai, step } = await unusedLaunchThenPlainHop();
    let sawTakeoff = false;
    for (let i = 0; i < 20; i++) {
      const grounded = isGrounded(harness.physics, harness.second.collider);
      const timerBefore = ai.getDebugState().reactionTimerS;
      const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const debug = ai.getDebugState();
      if (!grounded) {
        sawTakeoff = true;
        expect(harness.second.dodge.isAirRecoveryAvailable(), `hop tick ${i}: no window on a plain hop`).toBe(false);
        expect(debug.activeIntent).not.toBe(AiIntent.AirRecover);
        expect(actions.pressedThisFrame.has(Action.Dodge)).toBe(false);
        // The reaction timer only goes down when a fresh decision is taken
        // (reset to exactly 0). A phantom launch restarted it at one tick
        // with no decision at all.
        if (debug.reactionTimerS < timerBefore) expect(debug.reactionTimerS, `hop tick ${i}: reaction cycle restarted by a phantom launch`).toBe(0);
      }
      step(actions);
    }
    expect(sawTakeoff, 'the plain hop left the ground').toBe(true);
  });

  it('a Dodge press on that first airborne tick really recovers nothing (what the old reading claimed was possible)', async () => {
    const { harness, step } = await unusedLaunchThenPlainHop();
    const airRecovery = vi.spyOn(harness.second.spin, 'applyAirRecovery');
    for (let i = 0; i < 20 && isGrounded(harness.physics, harness.second.collider); i++) step();
    expect(isGrounded(harness.physics, harness.second.collider), 'first airborne tick of the plain hop').toBe(false);
    step(DODGE_PRESS);
    expect(airRecovery).not.toHaveBeenCalled();
  });
});
