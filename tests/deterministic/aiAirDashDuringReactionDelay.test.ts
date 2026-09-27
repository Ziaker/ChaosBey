// ============================================================
// AI DASH CHARGE THROUGH THE REACTION DELAY AFTER A LAUNCH (M7 HOTFIX)
// Real physics + real tickMatch(), tick by tick. Owner decision after PR
// #16: a charge the AI is holding when it is launched stays held for that
// whole flight — including the reaction-delay ticks BEFORE AirRecover is
// decided, when the previous intent (AttackDash) is still in charge and
// used to release the charge the moment it reached its target, firing the
// Dash from the air (M7 trace: charge 0.98 -> 1.00 at t314, DashActive in
// the air at t315, AirRecover only decided then). The reaction delay
// itself is unchanged.
//
// Control: a VOLUNTARY airborne period (no launch, so no air-recovery
// window) is left alone — the same AI still releases its charge in the
// air when its normal logic says so. A fix that simply forbade releasing
// while airborne fails this.
// ============================================================

import { describe, expect, it } from 'vitest';
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

/** aggression 0 -> the AI charges to 0.9 before releasing (ActionSelection.dashTargetChargeFraction). */
const PERSONALITY = { ...ATTACK_AI_PERSONALITY, aggression: 0, errorRate: 0, counterAffinity: 0 };
/** The charge the AI has reached, on the ground, when it is sent airborne — close enough to its target that the reaction delay outlasts the rest of the charge. */
const CHARGE_AT_LIFTOFF = 0.8;

interface Tick {
  tick: number;
  grounded: boolean;
  windowOpen: boolean;
  intent: AiIntent;
  stateBefore: AttackState;
  stateAfter: AttackState;
  chargeBefore: number;
  attackHeld: boolean;
  attackPressed: boolean;
}

async function run(launch: boolean): Promise<Tick[]> {
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: -6 }, { x: 0, y: 0.5, z: 0 }, {}, new NullAiMashSource());
  const ai = new AIController(harness.physics, harness.second, harness.first, harness.clash.controller, PERSONALITY, DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText('air-dash-reaction-delay'));
  const idle = new IdleController();
  const step = () => harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));

  const ready = () =>
    harness.second.attack.getState() === AttackState.ChargingDash &&
    harness.second.attack.getChargeFraction() >= CHARGE_AT_LIFTOFF &&
    isGrounded(harness.physics, harness.second.collider);
  for (let i = 0; i < 900 && !ready(); i++) step();
  expect(ready(), `the AI is really charging on the ground, at >= ${CHARGE_AT_LIFTOFF}`).toBe(true);
  expect(ai.getDebugState().activeIntent).toBe(AiIntent.AttackDash);

  // A launch is what tickMatch does on a real hit: registerLaunch + upward
  // velocity. The voluntary control gets the same velocity without it.
  if (launch) harness.second.dodge.registerLaunch(false);
  const v = harness.second.body.linvel();
  harness.second.body.setLinvel({ x: v.x, y: 2.5, z: v.z }, true);

  const ticks: Tick[] = [];
  for (let tick = 0; tick < 200; tick++) {
    const grounded = isGrounded(harness.physics, harness.second.collider);
    const windowOpen = !grounded && harness.second.dodge.isAirRecoveryAvailable();
    const stateBefore = harness.second.attack.getState();
    const chargeBefore = harness.second.attack.getChargeFraction();
    const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const intent = ai.getDebugState().activeIntent;
    harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), actions);
    ticks.push({
      tick,
      grounded,
      windowOpen,
      intent,
      stateBefore,
      stateAfter: harness.second.attack.getState(),
      chargeBefore,
      attackHeld: actions.held.has(Action.Attack),
      attackPressed: actions.pressedThisFrame.has(Action.Attack),
    });
  }
  return ticks;
}

/** The first airborne period after liftoff, up to (not including) the first grounded tick after it. */
function flight(ticks: Tick[]): Tick[] {
  const start = ticks.findIndex((t) => !t.grounded);
  const end = ticks.findIndex((t, i) => i > start && t.grounded);
  expect(start, 'went airborne').toBeGreaterThanOrEqual(0);
  expect(end, 'landed within the run').toBeGreaterThan(start);
  return ticks.slice(start, end);
}

const reactionTicks = Math.ceil((PERSONALITY.reactionDelaySeconds * DEFAULT_AI_DIFFICULTY_PROFILE.reactionDelayMultiplier) / FIXED_DELTA_SECONDS - 1e-9);

describe('AI Dash charge through the reaction delay after a launch (real physics)', () => {
  it('launched near full charge: keeps holding through the delay (charge reaches 100%), no Dash in the air, AirRecover on its normal delay, normal logic back on the ground', async () => {
    const ticks = await run(true);
    const air = flight(ticks);

    // Launched mid-charge, window seen.
    const windowOpened = air.find((t) => t.windowOpen);
    expect(windowOpened, 'the launch opened an air-recovery window').toBeDefined();
    expect(air[0]!.stateBefore).toBe(AttackState.ChargingDash);

    // Reaction delay unchanged: AirRecover is decided no earlier than a full
    // reaction delay after the window was first seen.
    const firstAirRecover = air.find((t) => t.intent === AiIntent.AirRecover);
    expect(firstAirRecover, 'AirRecover decided in the air').toBeDefined();
    expect(firstAirRecover!.tick - windowOpened!.tick).toBeGreaterThanOrEqual(reactionTicks - 1);

    // During the delay the previous intent is still active...
    const beforeRecover = air.filter((t) => t.tick < firstAirRecover!.tick);
    expect(beforeRecover.every((t) => t.intent === AiIntent.AttackDash), 'previous intent during the delay').toBe(true);
    // ...and the charge reaches 100% there while Attack stays held.
    expect(beforeRecover.some((t) => t.stateBefore === AttackState.ChargingDash && t.chargeBefore >= 1 && t.attackHeld), 'full charge held during the delay').toBe(true);

    // Held for the whole flight, never newly pressed, never released in the air.
    for (const t of air) {
      if (t.stateBefore === AttackState.ChargingDash) expect(t.attackHeld, `tick ${t.tick}: charge held in the air`).toBe(true);
      expect(t.attackPressed, `tick ${t.tick}: no new Attack press in the air`).toBe(false);
      expect(t.stateAfter, `tick ${t.tick}: no Dash released in the air`).not.toBe(AttackState.DashActive);
    }

    // Back on the ground the normal logic decides: the charge is released
    // there (a normal grounded Dash), not kept forever.
    const landedAt = air[air.length - 1]!.tick + 1;
    const release = ticks.find((t) => t.tick >= landedAt && t.stateBefore === AttackState.ChargingDash && t.stateAfter === AttackState.DashActive);
    expect(release, 'released after landing').toBeDefined();
    expect(release!.grounded).toBe(true);
  }, 30000);

  it('control — voluntary airborne (no launch): the same charge is still released in the air by the normal logic', async () => {
    const ticks = await run(false);
    const air = flight(ticks);
    expect(air.some((t) => t.windowOpen), 'no air-recovery window without a launch').toBe(false);
    expect(air.some((t) => t.intent === AiIntent.AirRecover)).toBe(false);
    const airRelease = air.find((t) => t.stateBefore === AttackState.ChargingDash && t.stateAfter === AttackState.DashActive);
    expect(airRelease, 'air attack from a voluntary airborne period stays allowed').toBeDefined();
    expect(airRelease!.attackHeld, 'released by the AI letting go (its normal logic)').toBe(false);
  }, 30000);
});
