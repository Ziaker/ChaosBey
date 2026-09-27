// ============================================================
// AI VS PLAYER STAND-IN — BEHAVIORAL DISTINCTNESS (M7 ALPHA-READINESS)
// GDD section 64: Player-vs-AI is the game's primary experience, and
// Attack/Defense/Stamina must feel like different, interesting opponents,
// not just three working algorithms that happen to score differently
// against each other. This headless environment has no human playtester,
// so this sweep drives each archetype's real AIController against a fixed,
// non-adaptive PlayerStandInController (playerStandInController.ts) —
// same tickMatch()/CombatHarness path production uses — and checks the
// archetypes stay observably distinct (not just internally scored
// differently) even against an opponent that never adapts to them, the
// way a consistent human player might not either.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY, STAMINA_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import type { AiPersonality } from '../../src/ai/personalities/AiPersonality';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import type { BeyDefinition } from '../../src/bey/archetype/BeyDefinition';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';
import { PlayerStandInController } from './playerStandInController';

const MAX_TICKS = 6000; // ~100s, same generous ceiling aiMatchRunner uses.
const SEEDS = ['pv-0', 'pv-1', 'pv-2', 'pv-3', 'pv-4', 'pv-5', 'pv-6', 'pv-7'];
const TICKS_PER_SECOND = Math.round(1 / FIXED_DELTA_SECONDS);
const MAX_STALLED_ATTACK_TICKS = Math.round(0.5 * TICKS_PER_SECOND);
const MAX_PRESSES_PER_SECOND = 6;

interface ArchetypeRun {
  personalityId: string;
  definition: BeyDefinition;
  personality: AiPersonality;
}

const ARCHETYPES: ArchetypeRun[] = [
  { personalityId: 'attack', definition: ATTACK_ARCHETYPE, personality: ATTACK_AI_PERSONALITY },
  { personalityId: 'defense', definition: DEFENSE_ARCHETYPE, personality: DEFENSE_AI_PERSONALITY },
  { personalityId: 'stamina', definition: STAMINA_ARCHETYPE, personality: STAMINA_AI_PERSONALITY },
];

interface RunStats {
  seed: string;
  outcome: RoundOutcome;
  ticks: number;
  aiWon: boolean;
  dashes: number;
  counterHits: number;
  hitsLanded: number;
  hitsTaken: number;
  circleOrWaitTicks: number;
  activeTicks: number;
  longestStalledAttackTicks: number;
  maxPressesPerSecond: number;
}

async function runVsPlayerStandIn(archetype: ArchetypeRun, seed: string): Promise<RunStats> {
  const harness = await CombatHarness.create(undefined, undefined, {}, new NullAiMashSource(), {
    first: archetype.definition,
    second: archetype.definition, // same body/collider profile for the stand-in; only the AI side's archetype is under test.
  });
  const ai = new AIController(
    harness.physics,
    harness.first,
    harness.second,
    harness.clash.controller,
    archetype.personality,
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText(`${seed}/ai`),
  );
  const player = new PlayerStandInController(harness.physics, harness.second, harness.first, harness.clash.controller, SeededRng.fromSeedText(`${seed}/player`));

  let dashes = 0;
  let counterHits = 0;
  let hitsLanded = 0;
  let hitsTaken = 0;
  let circleOrWaitTicks = 0;
  let activeTicks = 0;
  let previousAttackState = AttackState.Neutral;
  let stalledStreak = 0;
  let longestStalledAttackTicks = 0;
  const pressTicks: number[] = [];
  let maxPressesPerSecond = 0;
  const windowTicks = TICKS_PER_SECOND;
  let ticks = 0;

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    const aiActions: ControllerActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const playerActions: ControllerActions = player.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const result = harness.tick(aiActions, playerActions);
    ticks = tick + 1;

    const clashActive = harness.clash.controller.getState() === ClashState.Active;
    if (!clashActive) {
      activeTicks++;
      const debug = ai.getDebugState();
      if (debug.activeIntent === AiIntent.Circle || debug.activeIntent === AiIntent.Wait) circleOrWaitTicks++;

      const attackIntent = debug.activeIntent === AiIntent.AttackCircular || debug.activeIntent === AiIntent.AttackDash;
      const stalled =
        attackIntent &&
        result.first.attackState === AttackState.Neutral &&
        result.first.attackEnergyFraction > 0.3 &&
        !aiActions.held.has(Action.Attack);
      stalledStreak = stalled ? stalledStreak + 1 : 0;
      longestStalledAttackTicks = Math.max(longestStalledAttackTicks, stalledStreak);

      for (const action of [Action.Attack, Action.Dodge, Action.JumpDrift]) {
        if (aiActions.pressedThisFrame.has(action)) pressTicks.push(tick);
      }
      while (pressTicks.length > 0 && pressTicks[0]! <= tick - windowTicks) pressTicks.shift();
      maxPressesPerSecond = Math.max(maxPressesPerSecond, pressTicks.length);

      if (result.first.attackState === AttackState.DashActive && previousAttackState !== AttackState.DashActive) dashes++;
      previousAttackState = result.first.attackState;
    }
    for (const hit of result.hitEvents) {
      if (hit.attackerIsFirst) {
        hitsLanded++;
        if (hit.caughtOpponentDashing) counterHits++;
      } else {
        hitsTaken++;
      }
    }

    if (harness.roundState.isOver) break;
  }

  const outcome = harness.roundState.result;
  const aiWon = outcome === RoundOutcome.FirstWinsByKo || outcome === RoundOutcome.FirstWinsByRingOut;
  return { seed, outcome, ticks, aiWon, dashes, counterHits, hitsLanded, hitsTaken, circleOrWaitTicks, activeTicks, longestStalledAttackTicks, maxPressesPerSecond };
}

describe('AI vs a fixed, non-adaptive player stand-in (M7 alpha-readiness)', () => {
  it(
    'every archetype resolves cleanly against the stand-in with no degenerate behavior',
    async () => {
      const allRuns: { archetype: string; stats: RunStats }[] = [];
      for (const archetype of ARCHETYPES) {
        for (const seed of SEEDS) {
          allRuns.push({ archetype: archetype.personalityId, stats: await runVsPlayerStandIn(archetype, seed) });
        }
      }

      for (const { archetype, stats } of allRuns) {
        const label = `${archetype} vs stand-in [${stats.seed}]`;
        expect(stats.outcome, `${label}: must resolve`).not.toBe(RoundOutcome.Ongoing);
        expect(stats.longestStalledAttackTicks, `${label}: stalled attack`).toBeLessThanOrEqual(MAX_STALLED_ATTACK_TICKS);
        expect(stats.maxPressesPerSecond, `${label}: button spam`).toBeLessThanOrEqual(MAX_PRESSES_PER_SECOND);
      }

      const byArchetype = new Map<string, RunStats[]>();
      for (const { archetype, stats } of allRuns) {
        const list = byArchetype.get(archetype) ?? [];
        list.push(stats);
        byArchetype.set(archetype, list);
      }
      const rate = (list: RunStats[], pick: (s: RunStats) => number) => {
        const totalTicks = list.reduce((sum, s) => sum + s.activeTicks, 0);
        const totalPick = list.reduce((sum, s) => sum + pick(s), 0);
        return (totalPick / Math.max(1, totalTicks)) * TICKS_PER_SECOND * 60;
      };
      const attack = byArchetype.get('attack')!;
      const defense = byArchetype.get('defense')!;
      const stamina = byArchetype.get('stamina')!;

      console.log(
        [
          'AI vs player stand-in report:',
          ...(['attack', 'defense', 'stamina'] as const).map((key) => {
            const list = byArchetype.get(key)!;
            const wins = list.filter((s) => s.aiWon).length;
            return `  ${key}: ${wins}/${list.length} won, ${rate(list, (s) => s.dashes).toFixed(1)} dashes/min, ${rate(list, (s) => s.counterHits).toFixed(2)} counters/min, passive ${((100 * list.reduce((sum, s) => sum + s.circleOrWaitTicks, 0)) / list.reduce((sum, s) => sum + s.activeTicks, 0)).toFixed(0)}%`;
          }),
        ].join('\n'),
      );

      // Same identity checks aiArchetypeMatrix makes AI-vs-AI (GDD section 64), now against a fixed, non-adaptive opponent instead of another archetype.
      // counterHits is reported above but not asserted on: PlayerStandInController is a plain, non-adaptive stand-in without the AI's own alignment
      // discipline, so its Dashes don't reliably land "closing" fast enough to count as counterable — that's a limitation of this test double, not
      // of Defense's real counter behavior (already covered AI-vs-AI in aiArchetypeMatrix.test.ts).
      expect(rate(attack, (s) => s.dashes), 'Attack should dash far more than Stamina even against a fixed opponent').toBeGreaterThan(1.2 * rate(stamina, (s) => s.dashes));
      const passiveShare = (list: RunStats[]) => list.reduce((sum, s) => sum + s.circleOrWaitTicks, 0) / list.reduce((sum, s) => sum + s.activeTicks, 0);
      expect(passiveShare(stamina), 'Stamina should play more patiently than Attack even against a fixed opponent').toBeGreaterThan(passiveShare(attack) + 0.05);
      expect(passiveShare(defense), 'Defense should sit between Attack and Stamina on patience even against a fixed opponent').toBeGreaterThan(passiveShare(attack));
    },
    120000,
  );
});
