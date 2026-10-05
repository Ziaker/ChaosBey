// ============================================================
// AI CLASH WILLINGNESS — INTEGRATION (MILESTONE 7 PART 2b)
// Real physics + real tickMatch() + the real Clash system. GDD section
// 42/63: the AI can intentionally create/accept Clash opportunities.
//
// A scripted opponent charges a Dash while the AI (Attack archetype, no
// counter read, no deliberate errors) closes in from outside Dash range.
// Two runs differ only in caution, which at Dash range only reaches the
// scores through clashWillingness (AttackCircular is out of range; Approach
// and AttackDash don't read caution otherwise). At the first fresh decision
// that meets a legitimate opportunity (opponent attacking, Clash Idle, AI
// free, in Dash range, outside the threat override):
//   - willing AI: commits to a Dash into the opponent's — and a real Clash
//     starts;
//   - reluctant AI: declines (keeps approaching) — and no Clash happens.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import type { AiDebugState } from '../../src/ai/debug/AiDebugState';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const RUN_TICKS = 240;
/** Beyond the threat override (opponentThreat >= 0.35 at ~4.2 m), where scoring — and so willingness — decides. */
const MIN_SCORING_DISTANCE_M = 4.3;
const DASH_RANGE_M = 9;
const OPPONENT_ENGAGED: ReadonlySet<AttackState> = new Set([AttackState.Buffering, AttackState.ChargingDash, AttackState.CircularActive, AttackState.DashActive]);

interface Tick {
  debug: AiDebugState;
  opponentState: AttackState;
  clashStateBefore: ClashState;
  aiAttackStateBefore: AttackState;
}

async function run(caution: number) {
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: -10 }, { x: 0, y: 0.5, z: 0 }, {}, new NullAiMashSource());
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    { ...ATTACK_AI_PERSONALITY, caution, counterAffinity: 0, errorRate: 0 },
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText('clash-willingness'),
  );
  // The opponent charges from tick 30 and releases its Dash at tick 140 (was 120) —
  // 110 before the Motion Lab integration (M11): the AI now keeps drifting
  // toward it while charging (rolling drag only when coasting), so an
  // earlier release hit it before its own Dash left. 115–125 all Clash.
  // 140 since the owner audit (2026-10-04): with the current rules 125–155 all Clash and 120 no longer does.
  const opponent = new ScriptedController([
    { fromTick: 30, held: [Action.Attack] },
    { fromTick: 140, held: [] },
  ]);
  const ticks: Tick[] = [];
  let clashStartedAt: number | null = null;
  for (let i = 0; i < RUN_TICKS && !harness.roundState.isOver; i++) {
    const clashStateBefore = harness.clash.controller.getState();
    const aiAttackStateBefore = harness.second.attack.getState();
    const opponentState = harness.first.attack.getState();
    const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    ticks.push({ debug: ai.getDebugState(), opponentState, clashStateBefore, aiAttackStateBefore });
    harness.tick(opponent.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), actions);
    if (clashStartedAt === null && harness.clash.controller.getState() === ClashState.Active) clashStartedAt = i;
    for (const value of [harness.second.body.translation().x, harness.second.body.translation().z, harness.second.body.linvel().x]) {
      expect(Number.isFinite(value), `tick ${i}: finite AI state`).toBe(true);
    }
  }
  // First fresh decision (reaction timer just reset) facing a legitimate Clash opportunity.
  const opportunity = ticks.findIndex(
    (t) =>
      t.debug.reactionTimerS === 0 &&
      OPPONENT_ENGAGED.has(t.opponentState) &&
      t.clashStateBefore === ClashState.Idle &&
      t.aiAttackStateBefore === AttackState.Neutral &&
      t.debug.distanceToOpponentM > MIN_SCORING_DISTANCE_M &&
      t.debug.distanceToOpponentM <= DASH_RANGE_M,
  );
  return { ticks, opportunity, clashStartedAt };
}

const scoreOf = (debug: AiDebugState, intent: AiIntent) => debug.consideredScores.find((entry) => entry.intent === intent)?.score;

describe('AI Clash willingness in a real match (M7 Part 2b)', () => {
  it('a willing AI accepts a legitimate Clash opportunity and a real Clash starts; a reluctant one declines it', async () => {
    const willing = await run(ATTACK_AI_PERSONALITY.caution);
    const reluctant = await run(0.9);

    // The same opportunity, at the same moment and distance, for both.
    expect(willing.opportunity, 'a legitimate Clash opportunity arose').toBeGreaterThan(0);
    expect(reluctant.opportunity).toBe(willing.opportunity);
    const w = willing.ticks[willing.opportunity]!;
    const r = reluctant.ticks[reluctant.opportunity]!;
    expect(r.debug.distanceToOpponentM).toBeCloseTo(w.debug.distanceToOpponentM, 9);
    expect(w.opponentState).toBe(AttackState.ChargingDash);

    // Willingness is what differs: attack scores scaled by it, the rest identical.
    expect(w.debug.clashWillingness).toBeGreaterThan(r.debug.clashWillingness);
    expect(r.debug.clashWillingness).toBeLessThan(1);
    expect(scoreOf(r.debug, AiIntent.AttackDash)!).toBeCloseTo((scoreOf(w.debug, AiIntent.AttackDash)! * r.debug.clashWillingness) / w.debug.clashWillingness, 9);
    expect(scoreOf(r.debug, AiIntent.Approach)).toBe(scoreOf(w.debug, AiIntent.Approach));

    // The choices, and what they lead to in the real Clash system.
    expect(w.debug.idealIntent, 'willing: meets the opponent\'s Dash with its own').toBe(AiIntent.AttackDash);
    expect(r.debug.idealIntent, 'reluctant: declines the exchange').not.toBe(AiIntent.AttackDash);
    expect(r.debug.idealIntent).not.toBe(AiIntent.PressAdvantage);
    expect(willing.clashStartedAt, 'a real Clash started').not.toBeNull();
    expect(willing.clashStartedAt!).toBeGreaterThan(willing.opportunity);
    expect(reluctant.clashStartedAt, 'no Clash for the AI that declined').toBeNull();
  });
});
