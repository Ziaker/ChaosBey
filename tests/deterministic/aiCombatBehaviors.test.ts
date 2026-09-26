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

  it('PressAdvantage actually lands/attempts an attack against a Broken opponent, not just movement (regression for the M7 part 1 review)', async () => {
    // Spawned at mid-range so the opportunity is real before the AI closes
    // in — PressAdvantage should be chosen specifically because the
    // opponent is Broken (GDD section 64: Attack AI "pressures broken
    // Stability"), not merely a coincidental AttackCircular/AttackDash pick.
    const harness = await CombatHarness.create({ x: 0, y: 0.6, z: -3 }, { x: 0, y: 0.6, z: 3 });
    // Force the opponent (first) into the Broken state via the same public
    // API tickMatch itself uses — no private/cheat access.
    while (!harness.first.stability.isBroken) {
      harness.first.stability.applyDamage(1000);
    }
    expect(harness.first.stability.isBroken).toBe(true);

    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      ATTACK_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('press-advantage-seed'),
    );
    const idle = new IdleController();

    let sawPressAdvantageIntent = false;
    let attackedWhilePressingAdvantage = false;
    let landedAHit = false;
    for (let i = 0; i < 600 && !landedAHit; i++) {
      const firstActions = idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const debug = ai.getDebugState();
      if (debug.activeIntent === 'PressAdvantage') {
        sawPressAdvantageIntent = true;
        if (secondActions.held.has(Action.Attack) || secondActions.pressedThisFrame.has(Action.Attack)) {
          attackedWhilePressingAdvantage = true;
        }
      }
      const result = harness.tick(firstActions, secondActions);
      if (result.hitEvents.some((h) => !h.attackerIsFirst)) landedAHit = true;
    }

    expect(sawPressAdvantageIntent).toBe(true);
    expect(attackedWhilePressingAdvantage).toBe(true);
    expect(landedAHit).toBe(true);
  });

  it('AttackDash charge survives re-decisions while ChargingDash and releases by charge target, not the reaction timer (regression for the M7 part 1 review)', async () => {
    // Spawned far enough apart that AttackDash (not Circular) is the chosen
    // approach, and a Stamina personality's short 0.2s reaction delay gives
    // several fresh-decision opportunities across a multi-second charge.
    const harness = await CombatHarness.create({ x: 0, y: 0.6, z: -6 }, { x: 0, y: 0.6, z: 6 });
    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      ATTACK_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('attack-dash-commitment-seed'),
    );
    const idle = new IdleController();

    // Same formula ActionSelection.ts's dashTargetChargeFraction() derives
    // from personality alone — replicated here (not imported, it's a
    // private helper) purely to know which tick is the intentional release
    // point versus a plain mid-charge tick, so the assertion below can
    // exclude the exact transition tick (where the real AttackController
    // hasn't yet advanced past ChargingDash but the AI has already, validly,
    // stopped holding Attack this same tick).
    const dashTargetChargeFraction = Math.max(0.15, Math.min(0.95, 0.9 - ATTACK_AI_PERSONALITY.aggression * 0.5));

    const effectiveReactionDelayS = ATTACK_AI_PERSONALITY.reactionDelaySeconds * DEFAULT_AI_DIFFICULTY_PROFILE.reactionDelayMultiplier;

    let sawChargingDash = false;
    let reactionTimerExceededDelayWhileCharging = false;
    let attackReleasedByChargeTarget = false;
    let previousAttackState: string | null = null;

    for (let i = 0; i < 600; i++) {
      const firstActions = idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const debug = ai.getDebugState();
      const attackState = harness.second.attack.getState();
      const chargeFraction = harness.second.attack.getChargeFraction();

      if (attackState === 'ChargingDash') {
        sawChargingDash = true;
        // Below the target with margin: must still be held. At/near the
        // target: this may legitimately be the release tick (charge
        // fraction already crossed the target this tick, ahead of the real
        // AttackController's own state transition next tick) — covered by
        // the attackReleasedByChargeTarget assertion below instead.
        if (chargeFraction < dashTargetChargeFraction - 0.02) {
          expect(secondActions.held.has(Action.Attack)).toBe(true);
        }
        // reactionTimerS is deliberately NOT reset while committed (see
        // AIController's commitment lock) — it keeps climbing past what
        // would normally trigger a fresh decision. Observing it exceed the
        // personality's own reaction delay while still ChargingDash proves
        // a re-decision was due and was correctly suppressed, rather than
        // this test simply never reaching that point.
        if (debug.reactionTimerS > effectiveReactionDelayS) reactionTimerExceededDelayWhileCharging = true;
      }

      if (previousAttackState === 'ChargingDash' && attackState === 'DashActive') {
        // Charge just released this tick — must be because the real
        // AttackController's own charge fraction crossed the AI's target
        // (checked above throughout the charge), never because an
        // unrelated decision clock happened to fire.
        attackReleasedByChargeTarget = true;
      }

      previousAttackState = attackState;
      harness.tick(firstActions, secondActions);
    }

    expect(sawChargingDash).toBe(true);
    expect(reactionTimerExceededDelayWhileCharging).toBe(true);
    expect(attackReleasedByChargeTarget).toBe(true);
  });
});
