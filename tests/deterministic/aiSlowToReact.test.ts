// ============================================================
// AI "SLOW TO REACT" DELIBERATE ERROR — BEHAVIORAL TEST (MILESTONE 7)
// Regression for the M7 part 2 audit: the "extra reaction delay" error
// must delay the reaction to the decision that rolled it — the AI keeps
// acting on its previous intent until the delay elapses, and only then
// presses what the new decision calls for. Before the fix the new intent
// was acted on in the same tick and only the NEXT decision was pushed
// back. Asserted on the real ControllerActions sequence (what reaches
// tickMatch), not on IntentionalError's return value alone.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../../src/ai/personalities/AiPersonality';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { DodgeState } from '../../src/dodge/DodgeController';
import { Action } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const RUN_TICKS = 1200;

interface TickRecord {
  tick: number;
  activeIntent: AiIntent;
  pendingIntent: AiIntent | null;
  pendingDelayRemainingS: number;
  pressed: Set<Action>;
  held: Set<Action>;
  ownDodgeState: DodgeState;
  ownGrounded: boolean;
  /** Launched airborne with an air-recovery window this tick — AIController drops a late reaction then (the launch is a new situation). */
  ownLaunched: boolean;
  /** Edge risk behind the decision currently in effect (AiDebugState.edgeRiskFraction). */
  decisionEdgeRisk: number;
}

/** A scripted attacker that keeps re-starting attacks so DodgeThreat decisions keep coming up. */
function repeatedAttacker(): ScriptedController {
  const frames = [];
  for (let cycleStart = 0; cycleStart < RUN_TICKS; cycleStart += 90) {
    frames.push({ fromTick: cycleStart, held: [Action.MoveForward, Action.Attack] });
    frames.push({ fromTick: cycleStart + 45, held: [Action.MoveForward] });
  }
  return new ScriptedController(frames);
}

async function run(personality: AiPersonality, seed: string): Promise<TickRecord[]> {
  const harness = await CombatHarness.create({ x: 0, y: 0.6, z: -1.8 }, { x: 0, y: 0.6, z: 1.8 }, {}, new NullAiMashSource());
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    personality,
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText(seed),
  );
  const attacker = repeatedAttacker();
  const records: TickRecord[] = [];
  for (let tick = 0; tick < RUN_TICKS; tick++) {
    const ownDodgeState = harness.second.dodge.getState();
    const ownGrounded = isGrounded(harness.physics, harness.second.collider);
    const ownLaunched = !ownGrounded && harness.second.dodge.isAirRecoveryAvailable();
    const firstActions = attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const debug = ai.getDebugState();
    records.push({
      tick,
      activeIntent: debug.activeIntent,
      pendingIntent: debug.pendingIntent,
      pendingDelayRemainingS: debug.pendingDelayRemainingS,
      pressed: new Set(secondActions.pressedThisFrame),
      held: new Set(secondActions.held),
      ownDodgeState,
      ownGrounded,
      ownLaunched,
      decisionEdgeRisk: debug.edgeRiskFraction,
    });
    harness.tick(firstActions, secondActions);
  }
  return records;
}

interface LateReaction {
  decidedAtTick: number;
  delayS: number;
  intent: AiIntent;
  /** Tick the pending decision became active, or null if the run ended first. */
  activatedAtTick: number | null;
}

function lateReactions(records: TickRecord[]): LateReaction[] {
  const result: LateReaction[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const startsHere = r.pendingIntent !== null && (i === 0 || records[i - 1]!.pendingIntent === null);
    if (!startsHere || r.pendingIntent === null) continue;
    let activatedAtTick: number | null = null;
    for (let j = i + 1; j < records.length; j++) {
      if (records[j]!.pendingIntent === null) {
        activatedAtTick = j;
        break;
      }
    }
    result.push({ decidedAtTick: i, delayS: r.pendingDelayRemainingS, intent: r.pendingIntent, activatedAtTick });
  }
  return result;
}

describe('AI "slow to react" deliberate error', () => {
  // counterAffinity 0: this test isolates the Dodge answer (a Defense AI
  // otherwise often answers a Dash with a Circular counter instead).
  const surelyDodges = { ...DEFENSE_AI_PERSONALITY, dodgeSkill: 1, counterAffinity: 0 };

  it('control: without errors a DodgeThreat decision presses Dodge at the first tick a dodge can start', async () => {
    const records = await run({ ...surelyDodges, errorRate: 0 }, 'slow-to-react-control');
    expect(records.every((r) => r.pendingIntent === null)).toBe(true);
    let checked = 0;
    for (let i = 0; i < records.length; i++) {
      const r = records[i]!;
      if (r.activeIntent !== AiIntent.DodgeThreat || records[i - 1]?.activeIntent === AiIntent.DodgeThreat) continue;
      // Walk this DodgeThreat stretch until a dodge could first start
      // (grounded, Dodge Idle): the press must land exactly there.
      for (let t = i; t < records.length && records[t]!.activeIntent === AiIntent.DodgeThreat; t++) {
        const at = records[t]!;
        if (at.ownDodgeState !== DodgeState.Idle) break;
        if (at.ownGrounded) {
          expect(at.pressed.has(Action.Dodge)).toBe(true);
          checked++;
          break;
        }
        expect(at.pressed.has(Action.Dodge)).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps acting on the previous intent until the delay elapses, then presses what the late decision calls for', async () => {
    let checkedLateDodge = 0;
    let activated = 0;
    let cancelledByLaunch = 0;
    let preemptedByCritical = 0;
    for (const seed of ['slow-to-react-errors', 'slow-to-react-errors-2', 'slow-to-react-errors-3', 'slow-to-react-errors-4']) {
      const records = await run({ ...surelyDodges, errorRate: 1 }, seed);
      const late = lateReactions(records);
      expect(late.length).toBeGreaterThan(0);

      for (const reaction of late) {
        const intentBefore = records[reaction.decidedAtTick - 1]?.activeIntent ?? AiIntent.Circle;
        const expectedTicks = Math.ceil(reaction.delayS / FIXED_DELTA_SECONDS - 1e-9);
        if (reaction.activatedAtTick === null) continue;
        if (records[reaction.activatedAtTick]!.ownLaunched) {
          // Dropped, not activated: being launched overrides the lapse.
          cancelledByLaunch++;
          continue;
        }
        if (reaction.activatedAtTick - reaction.decidedAtTick < expectedTicks) {
          // Ended early: only a critical decision (a critical edge
          // situation that arose during the lapse — see
          // aiSlowToReactCriticalPreemption.test.ts) may replace it.
          expect(records[reaction.activatedAtTick]!.decisionEdgeRisk, `tick ${reaction.activatedAtTick}: replaced early only by a critical edge decision`).toBeGreaterThanOrEqual(0.85);
          preemptedByCritical++;
          continue;
        }
        activated++;

        // Not before the delay (it may be later only while a commitment of
        // the previous intent is still in flight).
        expect(reaction.activatedAtTick - reaction.decidedAtTick).toBeGreaterThanOrEqual(expectedTicks);

        // While pending, the previous intent keeps driving the Bey — no
        // freeze and no early switch.
        for (let t = reaction.decidedAtTick; t < reaction.activatedAtTick; t++) {
          expect(records[t]!.activeIntent).toBe(intentBefore);
        }
        expect(records[reaction.activatedAtTick]!.activeIntent).toBe(reaction.intent);

        if (reaction.intent === AiIntent.DodgeThreat && intentBefore !== AiIntent.DodgeThreat) {
          // Observable effect: no Dodge press during the lapse...
          for (let t = reaction.decidedAtTick; t < reaction.activatedAtTick; t++) {
            expect(records[t]!.pressed.has(Action.Dodge)).toBe(false);
          }
          // ...then, from activation on, the press lands on the first tick
          // a dodge can actually start (grounded, Dodge Idle, button free) —
          // not later, and not before.
          for (let t = reaction.activatedAtTick; t < records.length && records[t]!.activeIntent === AiIntent.DodgeThreat; t++) {
            const at = records[t]!;
            if (at.ownDodgeState !== DodgeState.Idle) break;
            if (at.ownGrounded && !records[t - 1]!.held.has(Action.Dodge)) {
              expect(at.pressed.has(Action.Dodge)).toBe(true);
              checkedLateDodge++;
              break;
            }
            expect(at.pressed.has(Action.Dodge)).toBe(false);
          }
        }
      }
    }
    // The runs must actually contain late DodgeThreat presses, or the
    // observable assertion above never ran.
    expect(checkedLateDodge).toBeGreaterThan(0);
    expect(activated).toBeGreaterThan(cancelledByLaunch + preemptedByCritical);
  });

  it('is deterministic: the same seed produces the same action sequence', async () => {
    const a = await run({ ...surelyDodges, errorRate: 1 }, 'slow-to-react-determinism');
    const b = await run({ ...surelyDodges, errorRate: 1 }, 'slow-to-react-determinism');
    const signature = (records: TickRecord[]) => records.map((r) => `${r.activeIntent}|${r.pendingIntent}|${[...r.held].sort().join(',')}|${[...r.pressed].sort().join(',')}`);
    expect(signature(a)).toEqual(signature(b));
  });
});
