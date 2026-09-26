// ============================================================
// AI AIR RECOVERY — INTEGRATION TEST (MILESTONE 7 PART 2b)
// GDD section 21: after a real knockback launch, the AI answers its own
// air-recovery window with a single Dodge press — through the same
// ControllerActions channel a player uses — even when the launch caught
// it mid-commitment (charging its own Dash), and only after a human
// reaction delay counted from the launch.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

/** Ticks of slack over the reaction delay: the timer resets on the first airborne tick of the window, then decides on the tick it reaches the delay. */
const REACTION_SLACK_TICKS = 2;

describe('AI air recovery (real physics)', () => {
  it('presses Dodge once per launch window, after a reaction delay from the launch — even when launched mid-Dash-charge', async () => {
    // Close spawn + a scripted attacker that keeps committing to attacks:
    // real knockback launches to react to, often while the AI (Attack
    // personality) is itself charging a Dash.
    const harness = await CombatHarness.create({ x: 0, y: 0.6, z: -1.2 }, { x: 0, y: 0.6, z: 1.2 }, {}, new NullAiMashSource());
    const personality = { ...ATTACK_AI_PERSONALITY, counterAffinity: 0 };
    const ai = new AIController(harness.physics, harness.second, harness.first, harness.clash.controller, personality, DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText('air-recovery-seed'));
    const frames = [];
    for (let start = 0; start < 900; start += 90) {
      frames.push({ fromTick: start, held: [Action.Attack] });
      frames.push({ fromTick: start + 45, held: [] });
    }
    const attacker = new ScriptedController(frames);
    const reactionTicks = Math.floor(personality.reactionDelaySeconds / FIXED_DELTA_SECONDS);

    let windows = 0;
    let recoveries = 0;
    let launchedWhileCharging = 0;
    let recoveredAfterChargingLaunch = 0;
    let windowOpenedAt: number | null = null;
    let windowChargingAtOpen = false;
    let pressesThisWindow = 0;

    for (let tick = 0; tick < 900 && !harness.roundState.isOver; tick++) {
      const open = !isGrounded(harness.physics, harness.second.collider) && harness.second.dodge.isAirRecoveryAvailable();
      if (open && windowOpenedAt === null) {
        windowOpenedAt = tick;
        windowChargingAtOpen = harness.second.attack.getState() === AttackState.ChargingDash;
        pressesThisWindow = 0;
        windows++;
        if (windowChargingAtOpen) launchedWhileCharging++;
      }
      const firstActions = attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const aiActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      if (windowOpenedAt !== null && aiActions.pressedThisFrame.has(Action.Dodge)) {
        pressesThisWindow++;
        // Human-speed: never before a full reaction delay from the launch —
        // and not much after it either (a launch mid-commitment used to be
        // answered only once the AI's own Dash had played out in the air).
        expect(tick - windowOpenedAt).toBeGreaterThanOrEqual(reactionTicks);
        expect(tick - windowOpenedAt).toBeLessThanOrEqual(reactionTicks + REACTION_SLACK_TICKS);
        expect(ai.getDebugState().activeIntent).toBe(AiIntent.AirRecover);
      }
      harness.tick(firstActions, aiActions);
      const stillOpen = !isGrounded(harness.physics, harness.second.collider) && harness.second.dodge.isAirRecoveryAvailable();
      if (windowOpenedAt !== null && !stillOpen) {
        // One press per window, never more (no mashing, no held button).
        expect(pressesThisWindow).toBeLessThanOrEqual(1);
        if (pressesThisWindow === 1) {
          recoveries++;
          if (windowChargingAtOpen) recoveredAfterChargingLaunch++;
        }
        windowOpenedAt = null;
      }
    }

    expect(windows).toBeGreaterThan(0);
    expect(recoveries).toBeGreaterThan(0);
    // The regression case: a launch that caught the AI mid-charge still
    // got answered (it used to keep charging in the air).
    expect(launchedWhileCharging).toBeGreaterThan(0);
    expect(recoveredAfterChargingLaunch).toBeGreaterThan(0);
  }, 60000);
});
