// ============================================================
// AI M7 PART 2 BEHAVIORS — INTEGRATION TESTS
// Real-physics coverage for the deeper offensive/evasive/adaptive
// behaviors added in M7 part 2: punishing a committed whiff, pressing an
// opponent exposed near the boundary, and triggering air recovery after a
// real knockback launch — through the same CombatHarness/tickMatch()
// pipeline every other controller uses.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { Action } from '../../src/input/actions/Action';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

describe('AI M7 part 2 — whiff punish', () => {
  it('presses the attack while the opponent is caught in DashRecovery from a committed whiff', async () => {
    // Opponent (first) is scripted to charge and release a Dash Attack
    // aimed away from the AI (no real target-seeking — a plain scripted
    // controller just holds Attack+MoveForward, so its Dash's own lock-on
    // still turns it toward whatever "opponent" position it reads, i.e.
    // the AI — the whiff instead comes from spawning them far enough apart
    // that the Dash's short active window ends before it can connect).
    const harness = await CombatHarness.create({ x: 0, y: 0.6, z: -9 }, { x: 0, y: 0.6, z: 9 });
    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      ATTACK_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('whiff-punish-seed'),
    );
    // Held/released in cycles (not a single permanent hold) so Buffering
    // actually re-triggers each cycle — ScriptedController's held/pressed
    // diffing only produces a fresh pressedThisFrame edge on a genuine
    // not-held->held transition, so a Dash charge that's never released
    // (attackEnergy alone would eventually force it, but not reliably
    // inside this test's tick budget) would otherwise never repeat.
    const frames = [];
    for (let cycleStart = 0; cycleStart < 1200; cycleStart += 120) {
      frames.push({ fromTick: cycleStart, held: [Action.Attack] });
      frames.push({ fromTick: cycleStart + 60, held: [] });
    }
    const attacker = new ScriptedController(frames);

    let sawOpponentInRecovery = false;
    let attackedDuringRecovery = false;
    for (let i = 0; i < 1200; i++) {
      const firstActions = attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      if (harness.first.attack.getState() === AttackState.DashRecovery) {
        sawOpponentInRecovery = true;
        if (secondActions.held.has(Action.Attack) || secondActions.pressedThisFrame.has(Action.Attack)) {
          attackedDuringRecovery = true;
        }
      }
      harness.tick(firstActions, secondActions);
    }

    expect(sawOpponentInRecovery).toBe(true);
    expect(attackedDuringRecovery).toBe(true);
  });
});

describe('AI M7 part 2 — edge pressure', () => {
  it('actively closes distance on an opponent exposed near the boundary rather than idling at range', async () => {
    const nearEdgeZ = RINGOUT_RADIUS_M - 1;
    const harness = await CombatHarness.create({ x: 0, y: 0.6, z: 0 }, { x: 0, y: 0.6, z: nearEdgeZ });
    const ai = new AIController(
      harness.physics,
      harness.first,
      harness.second,
      harness.clash.controller,
      ATTACK_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('edge-pressure-seed'),
    );
    const idleOpponent = new IdleController();

    const initialDistance = nearEdgeZ - 0;
    let closestDistance = initialDistance;
    for (let i = 0; i < 300; i++) {
      const firstActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondActions = idleOpponent.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      harness.tick(firstActions, secondActions);
      const firstT = harness.first.body.translation();
      const secondT = harness.second.body.translation();
      const dist = Math.hypot(firstT.x - secondT.x, firstT.z - secondT.z);
      closestDistance = Math.min(closestDistance, dist);
    }

    // The idle opponent never moves, so any meaningful closing of distance
    // is entirely the AI's own doing — pressing the boundary-exposed
    // opponent (GDD section 63) rather than staying put.
    expect(closestDistance).toBeLessThan(initialDistance - 3);
  });
});

describe('AI M7 part 2 — air recovery', () => {
  it('presses Dodge to trigger air recovery after being launched airborne by a real knockback', async () => {
    // Close spawn + an attacker that immediately commits to a Dash gives a
    // fast, deterministic real knockback launch to react to.
    const harness = await CombatHarness.create({ x: 0, y: 0.6, z: -1.2 }, { x: 0, y: 0.6, z: 1.2 });
    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      ATTACK_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('air-recovery-seed'),
    );
    const frames = [];
    for (let cycleStart = 0; cycleStart < 900; cycleStart += 90) {
      frames.push({ fromTick: cycleStart, held: [Action.Attack] });
      frames.push({ fromTick: cycleStart + 45, held: [] });
    }
    const attacker = new ScriptedController(frames);

    let wasLaunchedAirborne = false;
    let pressedDodgeWhileAirRecoveryAvailable = false;
    for (let i = 0; i < 900; i++) {
      const firstActions = attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      if (harness.second.dodge.isAirRecoveryAvailable()) {
        wasLaunchedAirborne = true;
        if (secondActions.pressedThisFrame.has(Action.Dodge)) pressedDodgeWhileAirRecoveryAvailable = true;
      }
      harness.tick(firstActions, secondActions);
    }

    expect(wasLaunchedAirborne).toBe(true);
    expect(pressedDodgeWhileAirRecoveryAvailable).toBe(true);
  });
});
