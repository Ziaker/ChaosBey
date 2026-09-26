// ============================================================
// AI AIR RECOVERY — INTEGRATION TESTS (MILESTONE 7 PART 2b)
// Real physics + real tickMatch(). GDD section 21: after being launched/
// knocked airborne, Dodge is an air recovery — a distinct action, never a
// general air dodge. Pins, end to end:
//   real Dash hit (knockback) -> airborne -> window open -> AI presses
//   Dodge -> tickMatch applies SpinController.applyAirRecovery (once) ->
//   window consumed -> AI lets go of Dodge.
// And: every airborne Dodge press happened with the window open; errors
// (errorRate 1) don't cancel it; a commitment in flight (a Dash charge)
// doesn't lock it out.
// ============================================================

import { describe, expect, it, vi } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import type { AiPersonality } from '../../src/ai/personalities/AiPersonality';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

type Spawn = { x: number; y: number; z: number };

interface TickRecord {
  tick: number;
  actions: ControllerActions;
  /** Before this tick: DodgeController armed AND airborne right now — a Dodge press this tick triggers air recovery. */
  windowOpenBefore: boolean;
  groundedBefore: boolean;
  windowOpenAfter: boolean;
  groundedAfter: boolean;
  airRecoveriesApplied: number;
  knockbackOnAi: boolean;
  activeIntent: AiIntent;
  deliberateErrorApplied: boolean;
}

async function setup(firstSpawn: Spawn, aiSpawn: Spawn, personality: AiPersonality, seed: string) {
  const harness = await CombatHarness.create(firstSpawn, aiSpawn, {}, new NullAiMashSource());
  const ai = new AIController(harness.physics, harness.second, harness.first, harness.clash.controller, personality, DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText(seed));
  const airRecovery = vi.spyOn(harness.second.spin, 'applyAirRecovery');
  const windowOpen = () => harness.second.dodge.isAirRecoveryAvailable() && !isGrounded(harness.physics, harness.second.collider);
  const grounded = () => isGrounded(harness.physics, harness.second.collider);

  const step = (first: CombatController, tick: number): TickRecord => {
    const windowOpenBefore = windowOpen();
    const groundedBefore = grounded();
    const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const callsBefore = airRecovery.mock.calls.length;
    const result = harness.tick(first.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), actions);
    const debug = ai.getDebugState();
    return {
      tick,
      actions,
      windowOpenBefore,
      groundedBefore,
      windowOpenAfter: windowOpen(),
      groundedAfter: grounded(),
      airRecoveriesApplied: airRecovery.mock.calls.length - callsBefore,
      knockbackOnAi: result.combatEvents.some((e) => e.kind === 'knockback' && !e.targetIsFirst),
      activeIntent: debug.activeIntent,
      deliberateErrorApplied: debug.deliberateErrorApplied,
    };
  };
  return { harness, step, airRecovery };
}

/** A scripted Dash straight into the AI; the AI can't dodge (dodgeSkill 0) or counter (counterAffinity 0), so it takes a real knockback. */
async function runKnockbackScenario(errorRate: number) {
  const personality = { ...DEFENSE_AI_PERSONALITY, counterAffinity: 0, dodgeSkill: 0, errorRate };
  const { harness, step, airRecovery } = await setup({ x: 0, y: 0.5, z: -3 }, { x: 0, y: 0.5, z: 0 }, personality, 'air-recovery');
  const dasher = new ScriptedController([
    { fromTick: 20, held: [Action.Attack] },
    { fromTick: 45, held: [] },
  ]);
  const records: TickRecord[] = [];
  for (let tick = 0; tick < 200 && !harness.roundState.isOver; tick++) records.push(step(dasher, tick));
  return { records, airRecovery };
}

/** The contract every run must satisfy: Dodge is only ever pressed in the air with the window open, and it isn't kept held once the window is gone. */
function expectNoGeneralAirDodge(records: readonly TickRecord[]): void {
  for (const record of records) {
    if (!record.groundedBefore && record.actions.pressedThisFrame.has(Action.Dodge)) {
      expect(record.windowOpenBefore, `tick ${record.tick}: airborne Dodge press outside the window`).toBe(true);
    }
    if (!record.groundedBefore && !record.windowOpenBefore) {
      expect(record.actions.held.has(Action.Dodge), `tick ${record.tick}: Dodge held in the air with no window`).toBe(false);
    }
  }
}

describe('AI air recovery (M7 Part 2b)', () => {
  for (const errorRate of [0, 1]) {
    it(`real knockback -> airborne -> window -> Dodge -> air recovery, exactly once, then lets go (errorRate ${errorRate})`, async () => {
      const { records, airRecovery } = await runKnockbackScenario(errorRate);

      const hitIndex = records.findIndex((r) => r.knockbackOnAi);
      expect(hitIndex, 'the Dash really knocked the AI back').toBeGreaterThanOrEqual(0);
      const windowIndex = records.findIndex((r, i) => i > hitIndex && r.windowOpenBefore);
      expect(windowIndex, 'the knockback launched it airborne with the window open').toBeGreaterThan(hitIndex);

      const pressIndex = records.findIndex((r) => r.actions.pressedThisFrame.has(Action.Dodge));
      expect(pressIndex, 'the AI pressed Dodge').toBeGreaterThanOrEqual(windowIndex);
      const press = records[pressIndex]!;
      expect(press.windowOpenBefore, 'pressed inside the window').toBe(true);
      expect(press.activeIntent).toBe(AiIntent.AirRecover);
      expect(press.deliberateErrorApplied, 'no deliberate error on a critical recovery').toBe(false);
      expect(press.airRecoveriesApplied, 'tickMatch applied SpinController.applyAirRecovery on the press tick').toBe(1);
      expect(press.groundedAfter, 'still airborne after the press').toBe(false);
      expect(press.windowOpenAfter, 'the window was consumed by the press').toBe(false);

      const next = records[pressIndex + 1]!;
      expect(next.actions.held.has(Action.Dodge), 'let go of Dodge once the window closed').toBe(false);
      expect(airRecovery).toHaveBeenCalledTimes(1);
      expectNoGeneralAirDodge(records);
    });
  }

  it('a commitment in flight (a Dash charge) does not lock air recovery out, and the charge is not dumped as an air Dash', async () => {
    // Attack AI charging a Dash at a far, idle opponent (committed: ChargingDash + AttackDash).
    const { harness, step } = await setup({ x: 0, y: 0.5, z: -8 }, { x: 0, y: 0.5, z: 0 }, { ...ATTACK_AI_PERSONALITY, errorRate: 0 }, 'air-recovery-commitment');
    const idle = new IdleController();
    let tick = 0;
    const chargingOnGround = () => harness.second.attack.getState() === AttackState.ChargingDash && isGrounded(harness.physics, harness.second.collider);
    for (; tick < 240 && !chargingOnGround(); tick++) step(idle, tick);
    expect(chargingOnGround(), 'the AI is charging a Dash on the ground').toBe(true);

    // Launch it exactly the way tickMatch does on a real hit (registerLaunch
    // with the same airborne flag + an upward impulse) — a scripted hit
    // can't be timed onto the AI's own charge deterministically.
    harness.second.dodge.registerLaunch(!isGrounded(harness.physics, harness.second.collider));
    const velocity = harness.second.body.linvel();
    harness.second.body.setLinvel({ x: velocity.x, y: 6, z: velocity.z }, true);

    const records: TickRecord[] = [];
    for (let i = 0; i < 90 && !harness.roundState.isOver; i++, tick++) records.push(step(idle, tick));

    const press = records.find((r) => r.actions.pressedThisFrame.has(Action.Dodge));
    expect(press, 'pressed Dodge while the charge commitment was still in flight').toBeDefined();
    expect(press!.windowOpenBefore).toBe(true);
    expect(press!.airRecoveriesApplied).toBe(1);
    const pressIndex = records.indexOf(press!);
    expect(records.slice(0, pressIndex + 1).every((r) => r.actions.held.has(Action.Attack)), 'kept the charge held up to and on the press tick').toBe(true);
    expectNoGeneralAirDodge(records);
  });
});
