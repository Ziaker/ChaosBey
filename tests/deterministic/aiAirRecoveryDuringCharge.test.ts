// ============================================================
// AI AIR RECOVERY DURING A DASH CHARGE — REGRESSION (MILESTONE 7 PART 2b)
// Real physics + real tickMatch(), tick by tick. The AI is really in
// ChargingDash (holding Attack) when it is launched (registerLaunch + an
// upward velocity: exactly what tickMatch does on a real hit). After its
// reaction delay it switches to AirRecover. AttackController reads "Attack
// no longer held" during ChargingDash as the release, so AirRecover
// dropping the button used to fire the Dash from the air. The AI must keep
// holding the charge it already had (no new press), press Dodge once for
// the air recovery, and fire the Dash only on the ground.
// ============================================================

import { describe, expect, it, vi } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

interface TickRecord {
  tick: number;
  grounded: boolean;
  windowOpen: boolean;
  intent: AiIntent;
  stateBefore: AttackState;
  stateAfter: AttackState;
  attackHeld: boolean;
  attackPressed: boolean;
  dodgePressed: boolean;
}

async function launchMidCharge(upwardSpeedMps: number): Promise<{ records: TickRecord[]; recoveriesApplied: number }> {
  // Opponent idle 6 m away: in Dash range, nothing else to react to.
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: -6 }, { x: 0, y: 0.5, z: 0 }, {}, new NullAiMashSource());
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    { ...ATTACK_AI_PERSONALITY, errorRate: 0, counterAffinity: 0 },
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText('air-recovery-during-charge'),
  );
  const airRecovery = vi.spyOn(harness.second.spin, 'applyAirRecovery');
  const idle = new IdleController();
  const step = () => harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));

  // Let the AI settle and really start charging its Dash.
  const chargingOnTheGround = () => harness.second.attack.getState() === AttackState.ChargingDash && isGrounded(harness.physics, harness.second.collider);
  for (let i = 0; i < 600 && !chargingOnTheGround(); i++) step();
  expect(harness.second.attack.getState(), 'the AI is really charging a Dash').toBe(AttackState.ChargingDash);
  expect(isGrounded(harness.physics, harness.second.collider), 'launched from the ground').toBe(true);

  harness.second.dodge.registerLaunch(false);
  const velocity = harness.second.body.linvel();
  harness.second.body.setLinvel({ x: velocity.x, y: upwardSpeedMps, z: velocity.z }, true);

  const records: TickRecord[] = [];
  for (let tick = 0; tick < 240; tick++) {
    const grounded = isGrounded(harness.physics, harness.second.collider);
    const windowOpen = !grounded && harness.second.dodge.isAirRecoveryAvailable();
    const stateBefore = harness.second.attack.getState();
    const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const intent = ai.getDebugState().activeIntent;
    harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), actions);
    records.push({
      tick,
      grounded,
      windowOpen,
      intent,
      stateBefore,
      stateAfter: harness.second.attack.getState(),
      attackHeld: actions.held.has(Action.Attack),
      attackPressed: actions.pressedThisFrame.has(Action.Attack),
      dodgePressed: actions.pressedThisFrame.has(Action.Dodge),
    });
  }
  return { records, recoveriesApplied: airRecovery.mock.calls.length };
}

describe('AI air recovery while charging a Dash (real physics, tick by tick)', () => {
  // Launch speeds giving a window comfortably longer than the Attack AI's reaction delay.
  for (const upwardSpeedMps of [1.7, 2.5]) {
    it(`launch at ${upwardSpeedMps} m/s mid-charge: AirRecover keeps the charge held, recovers once, and the Dash never fires in the air`, async () => {
      const { records, recoveriesApplied } = await launchMidCharge(upwardSpeedMps);

      // The launch episode: from the launch until the first tick back on the ground.
      const firstAirborne = records.findIndex((r) => !r.grounded);
      const landing = records.findIndex((r, i) => i > firstAirborne && r.grounded);
      expect(firstAirborne, 'the launch made the AI airborne').toBeGreaterThanOrEqual(0);
      expect(landing, 'the AI landed within the run').toBeGreaterThan(firstAirborne);
      const episode = records.slice(0, landing);

      const airRecoverTicks = records.filter((r) => r.intent === AiIntent.AirRecover);
      expect(airRecoverTicks.length, 'the intent switched to AirRecover').toBeGreaterThan(0);
      const firstAirRecover = airRecoverTicks[0]!;
      expect(firstAirRecover.grounded, 'decided while airborne').toBe(false);
      expect(firstAirRecover.stateBefore, 'still charging when AirRecover took over').toBe(AttackState.ChargingDash);

      // Dodge: one press, inside the window, and the recovery is applied.
      const dodgePresses = records.filter((r) => r.dodgePressed);
      expect(dodgePresses).toHaveLength(1);
      expect(dodgePresses[0]!.windowOpen).toBe(true);
      expect(dodgePresses[0]!.intent).toBe(AiIntent.AirRecover);
      expect(recoveriesApplied).toBe(1);

      // The charge that already existed stays held through AirRecover — and
      // no new Attack press is ever made after the launch while airborne.
      for (const r of airRecoverTicks) {
        if (r.stateBefore === AttackState.ChargingDash) expect(r.attackHeld, `tick ${r.tick}: charge held during AirRecover`).toBe(true);
      }
      expect(episode.filter((r) => r.attackPressed), 'no new Attack press in the air').toEqual([]);

      // No Dash released in the air (the whole launch episode stays in ChargingDash).
      const airDashStarts = episode.filter((r) => !r.grounded && r.stateBefore === AttackState.ChargingDash && r.stateAfter === AttackState.DashActive);
      expect(airDashStarts, 'Dash released while airborne').toEqual([]);

      // The charge doesn't stay stuck: it ends (released on the ground, or
      // Attack Energy runs out) within the run.
      const chargeEnd = records.find((r) => r.stateBefore === AttackState.ChargingDash && r.stateAfter !== AttackState.ChargingDash);
      expect(chargeEnd, 'the charge ends').toBeDefined();
      expect(chargeEnd!.grounded, 'released on the ground').toBe(true);
    }, 30000);
  }
});
