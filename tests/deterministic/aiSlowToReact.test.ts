// ============================================================
// AI "SLOW TO REACT" DELIBERATE ERROR — BEHAVIORAL TEST (M7 PART 2b)
// Written before the implementation, against ControllerActions (what the
// AI actually presses), not against an internal delay value:
//   ideal intent -> slow-to-react fires -> the corresponding action does
//   NOT happen yet -> the delay passes -> the action happens.
// Also: the delay is bounded and one-shot (the next decision without that
// error takes effect on its own tick — no permanent input lag), and the simulation
// keeps running during the delay (the previous intent keeps acting).
// The event is detected from the AiDecision telemetry record, so the test
// doesn't depend on how the delay is implemented.
// ============================================================

import { describe, expect, it, vi } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { SLOW_TO_REACT_MAX_DELAY_S, SLOW_TO_REACT_MIN_DELAY_S } from '../../src/ai/errors/IntentionalError';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { TelemetryEventKind } from '../../src/telemetry/events/TelemetryEvent';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { CombatHarness } from './combatHarness';

const MAX_TICKS = 30 * 60;
const ATTACK_INTENTS: ReadonlySet<string> = new Set([AiIntent.AttackCircular, AiIntent.AttackDash]);

interface TickRecord {
  tick: number;
  actions: ControllerActions;
  /** AiDecision telemetry emitted while sampling this tick's actions (0 or 1). */
  decision: { intent: string; reason: string; deliberateErrorApplied: boolean } | null;
  activeIntent: AiIntent;
  ownAttackStateBefore: AttackState;
  aiPosition: { x: number; z: number };
}

async function run() {
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.5, z: 1.8 }, {}, new NullAiMashSource());
  const telemetry = new TelemetryRecorder();
  // errorRate 1: every non-critical decision gets a deliberate error, so the
  // slow-to-react kind shows up within a few decisions.
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    { ...ATTACK_AI_PERSONALITY, errorRate: 1 },
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText('slow-to-react'),
    telemetry,
  );
  const idle = new IdleController();
  const records: TickRecord[] = [];
  for (let tick = 0; tick < MAX_TICKS && !harness.roundState.isOver; tick++) {
    telemetry.setCurrentTick(tick);
    const eventsBefore = telemetry.getEvents().length;
    const ownAttackStateBefore = harness.second.attack.getState();
    const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const newDecision = telemetry
      .getEvents()
      .slice(eventsBefore)
      .find((e) => e.kind === TelemetryEventKind.AiDecision);
    harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), actions);
    const position = harness.second.body.translation();
    records.push({
      tick,
      actions,
      decision:
        newDecision && newDecision.kind === TelemetryEventKind.AiDecision
          ? { intent: newDecision.intent, reason: newDecision.reason, deliberateErrorApplied: newDecision.deliberateErrorApplied }
          : null,
      activeIntent: ai.getDebugState().activeIntent,
      ownAttackStateBefore,
      aiPosition: { x: position.x, z: position.z },
    });
  }
  return records;
}

const pressesAttack = (r: TickRecord) => r.actions.pressedThisFrame.has(Action.Attack);

describe('AI slow-to-react deliberate error (M7 Part 2b)', () => {
  it('ideal attack -> slow to react -> no Attack press yet -> delay passes -> Attack press; bounded, one-shot, simulation keeps running', async () => {
    const records = await run();
    const minDelayTicks = Math.floor(SLOW_TO_REACT_MIN_DELAY_S / FIXED_DELTA_SECONDS);
    const maxDelayTicks = Math.ceil(SLOW_TO_REACT_MAX_DELAY_S / FIXED_DELTA_SECONDS);

    // The first slow-to-react on an attack, while the intent acting before it
    // wasn't an attack and an Attack press was possible right away.
    const eventIndex = records.findIndex(
      (r, i) =>
        i > 0 &&
        r.decision !== null &&
        /slow to react/.test(r.decision.reason) &&
        ATTACK_INTENTS.has(r.decision.intent) &&
        !ATTACK_INTENTS.has(records[i - 1]!.activeIntent) &&
        r.ownAttackStateBefore === AttackState.Neutral,
    );
    expect(eventIndex, 'a slow-to-react error fired on an attack decision').toBeGreaterThan(0);
    const event = records[eventIndex]!;
    expect(event.decision!.deliberateErrorApplied).toBe(true);

    // Not yet: no Attack press on the event tick nor for at least the minimum delay.
    const during = records.slice(eventIndex, eventIndex + minDelayTicks);
    expect(during.some(pressesAttack), 'the delayed attack must not be pressed during the delay').toBe(false);
    // ...while the simulation and the previous intent keep going (no freeze).
    expect(during.every((r) => r.actions.held instanceof Set)).toBe(true);
    const moved = Math.hypot(during.at(-1)!.aiPosition.x - event.aiPosition.x, during.at(-1)!.aiPosition.z - event.aiPosition.z);
    const previousIntentActed = during.some((r) => r.actions.held.size > 0) || moved > 0;
    expect(previousIntentActed, 'the previous intent keeps acting during the delay').toBe(true);

    // The delay passes: the attack is pressed, within the bound.
    const pressIndex = records.findIndex((r, i) => i > eventIndex && pressesAttack(r));
    expect(pressIndex, 'the delayed attack eventually happens').toBeGreaterThan(eventIndex);
    expect(pressIndex - eventIndex, 'no earlier than the minimum delay').toBeGreaterThanOrEqual(minDelayTicks);
    expect(pressIndex - eventIndex, 'within the maximum delay (+1 tick)').toBeLessThanOrEqual(maxDelayTicks + 1);
    expect(records[pressIndex]!.activeIntent, 'it is the delayed decision that lands').toBe(event.decision!.intent);

    // It is pressed the tick the delayed decision lands, not later.
    const landIndex = records.findIndex((r, i) => i > eventIndex && r.activeIntent === event.decision!.intent);
    expect(landIndex, 'pressed on the tick the delayed decision lands').toBe(pressIndex);

    // One-shot, no permanent input lag: the next decision that isn't itself
    // slow to react takes effect on the very tick it is made.
    const later = records.find((r, i) => i > pressIndex && r.decision !== null && !/slow to react/.test(r.decision.reason));
    expect(later, 'a later decision without the slow-to-react error').toBeDefined();
    expect(later!.activeIntent, 'acted on the same tick it was decided').toBe(later!.decision!.intent);
  });

  it('never holds back a critical decision: a launch while a slow reaction is pending gets AirRecover, and the pending decision never lands', async () => {
    const harness = await CombatHarness.create({ x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.5, z: 1.8 }, {}, new NullAiMashSource());
    // Short reaction cadence, so the critical decision comes well before any
    // pending delay (>= SLOW_TO_REACT_MIN_DELAY_S) could run out by itself.
    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      { ...ATTACK_AI_PERSONALITY, errorRate: 1, reactionDelaySeconds: 0.05 },
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('slow-to-react-critical'),
    );
    const airRecovery = vi.spyOn(harness.second.spin, 'applyAirRecovery');
    const idle = new IdleController();
    const step = () => {
      const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), actions);
      return actions;
    };

    let tick = 0;
    const pendingOnGround = () => ai.getDebugState().pendingIntent !== null && isGrounded(harness.physics, harness.second.collider);
    for (; tick < MAX_TICKS && !pendingOnGround(); tick++) step();
    expect(pendingOnGround(), 'a slow-to-react decision is pending').toBe(true);
    const pendingIntent = ai.getDebugState().pendingIntent!;
    expect(ai.getDebugState().activeIntent).not.toBe(pendingIntent);

    // Launched right now, the way tickMatch does on a real hit.
    harness.second.dodge.registerLaunch(!isGrounded(harness.physics, harness.second.collider));
    const velocity = harness.second.body.linvel();
    harness.second.body.setLinvel({ x: velocity.x, y: 6, z: velocity.z }, true);

    let pressed = false;
    for (let i = 0; i < 60 && !pressed; i++) {
      const actions = step();
      const debug = ai.getDebugState();
      expect(debug.activeIntent, `tick +${i}: the held-back decision must not land over the launch`).not.toBe(pendingIntent);
      pressed = actions.pressedThisFrame.has(Action.Dodge);
      if (pressed) expect(debug.activeIntent).toBe(AiIntent.AirRecover);
    }
    expect(pressed, 'AirRecover pressed Dodge').toBe(true);
    expect(airRecovery).toHaveBeenCalledTimes(1);
    expect(ai.getDebugState().pendingIntent, 'the critical decision dropped the pending one').toBeNull();
  });
});
