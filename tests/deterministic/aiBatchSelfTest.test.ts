// ============================================================
// AI VS AI BATCH SELF-TEST (MILESTONE 7 PART 2)
// GDD section 66/67/162/163: AI vs AI across every archetype pairing and
// several seeds, headless, through the real tickMatch(). Flags degenerate
// behavior (passivity, wasted/spammed presses, stuck attack states,
// matches that never end, invalid values) and checks the archetypes are
// observably different in aggregate. Prints one compact batch report.
//
// Scope note: this exercises tickMatch() only. Hitstop freezing and most
// telemetry are still orchestrated by main.ts, so this batch says nothing
// about input buffering through a freeze or runtime telemetry — the
// Chromium smoke (tests/smoke/aiRuntime.spec.ts) covers that path.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { AI_CIRCULAR_ATTACK_RANGE_M, AI_DASH_ATTACK_MAX_RANGE_M } from '../../src/ai/decision/AiCombatRanges';
import { personalityForBeyDefinitionId } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ClashOrchestration } from '../../src/app/simulation/ClashOrchestration';
import { tickMatch } from '../../src/app/simulation/tickMatch';
import { createArenaColliders } from '../../src/arena/colliders/createArenaColliders';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { createBey } from '../../src/bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { RoundState } from '../../src/combat/round-rules/RoundState';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { DodgeState } from '../../src/dodge/DodgeController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';
import { SeededRng } from '../../src/rng/SeededRng';

// ------------------------------------------------------------
// Thresholds — deliberately generous over what the batch measures today,
// so they catch degenerate behavior, not ordinary tuning drift.
// ------------------------------------------------------------
/** A match (no round timer yet) must still resolve within this. */
const MAX_MATCH_S = 90;
/** Longest stretch in which neither side starts any attack. */
const MAX_NO_ATTACK_GAP_S = 12;
/** Longest time one side may stay in a single non-Neutral attack state outside an Active Clash (charging auto-releases when Attack Energy runs out). */
const MAX_SINGLE_ATTACK_STATE_S = 4;
/**
 * Regression guard for "every AI dashed exactly once per match" (a stale
 * Dash charge made the AI believe it was already charged): a side that,
 * after its first Dash, spends at least this long (s, outside an Active
 * Clash) wanting another one — AttackDash intent, attack Neutral, in Dash
 * range, with Attack Energy — must actually Dash again. Conditioned on the
 * AI wanting it, so a patient personality that simply prefers other moves
 * later in a match is not flagged (an unconditional "two Dashes per 10 s"
 * check tripped on legitimate Stamina mirrors).
 */
const DASH_REARM_WANT_S = 1;
/** Longest the AI may want to attack (attack intent, Neutral, target in range, energy available) without pressing Attack — the direct symptom of the stale-charge bug. */
const MAX_STALLED_ATTACK_S = 0.5;

const ARCHETYPES = { attack: ATTACK_ARCHETYPE, defense: DEFENSE_ARCHETYPE, stamina: STAMINA_ARCHETYPE } as const;
type ArchetypeKey = keyof typeof ARCHETYPES;
const PAIRINGS: [ArchetypeKey, ArchetypeKey][] = [
  ['attack', 'defense'],
  ['attack', 'stamina'],
  ['defense', 'stamina'],
  ['attack', 'attack'],
  ['defense', 'defense'],
  ['stamina', 'stamina'],
];
const SEEDS = ['batch-1', 'batch-2', 'batch-3'];

interface ArchetypeTotals {
  seconds: number;
  dashes: number;
  counters: number;
  circleSeconds: number;
}

interface MatchReport {
  label: string;
  result: string;
  seconds: number;
  /** Seconds outside an Active Clash. */
  playSeconds: number;
  dashes: [number, number];
  /** Seconds each side spent wanting another Dash after its first one (see DASH_REARM_WANT_S). */
  wantedDashAgainS: [number, number];
  /** Longest stretch either side wanted to attack without pressing Attack. */
  longestStalledAttackS: number;
  maxNoAttackGapS: number;
  longestSingleAttackStateS: number;
  wastedPresses: number;
}

function assertFinite(value: number, label: string): void {
  expect(Number.isFinite(value), label).toBe(true);
}

function assertContract(actions: ControllerActions, label: string): void {
  for (const action of actions.pressedThisFrame) expect(actions.held.has(action), `${label}: pressed ⊆ held`).toBe(true);
  assertFinite(actions.attackHoldDurationSeconds, `${label}: attackHoldDurationSeconds`);
  assertFinite(actions.jumpDriftHoldDurationSeconds, `${label}: jumpDriftHoldDurationSeconds`);
}

async function runMatch(pairing: [ArchetypeKey, ArchetypeKey], seed: string, totals: Record<ArchetypeKey, ArchetypeTotals>): Promise<MatchReport> {
  const physics = await PhysicsWorld.create();
  createArenaColliders(new THREE.Scene(), physics);
  const beys = [
    createBey(physics, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -4 }, ARCHETYPES[pairing[0]]),
    createBey(physics, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 4 }, ARCHETYPES[pairing[1]]),
  ] as const;
  const clash = new ClashOrchestration(resolveMatchConfig(), new NullAiMashSource());
  const round = new RoundState();
  const ais = [0, 1].map(
    (i) =>
      new AIController(
        physics,
        beys[i]!,
        beys[1 - i]!,
        clash.controller,
        personalityForBeyDefinitionId(beys[i]!.definition.id),
        DEFAULT_AI_DIFFICULTY_PROFILE,
        SeededRng.fromSeedText(`${seed}-${i}`),
      ),
  );
  const label = `${pairing[0]} vs ${pairing[1]} [${seed}]`;

  const dashes: [number, number] = [0, 0];
  const previousAttackState = [AttackState.Neutral, AttackState.Neutral];
  /** Ticks spent in the current attack state, not counting Active-Clash ticks (a Clash freezes every state for its ~4 s presentation). */
  const ticksInAttackState = [0, 0];
  let lastAttackStartTick = 0;
  let maxNoAttackGapTicks = 0;
  let longestSingleAttackStateTicks = 0;
  let wastedPresses = 0;
  let tick = 0;
  let playTicks = 0;
  const wantedDashAgainTicks: [number, number] = [0, 0];
  const stalledAttackTicks = [0, 0];
  let longestStalledAttackTicks = 0;

  for (tick = 0; tick < MAX_MATCH_S * 60 && !round.isOver; tick++) {
    const clashActive = clash.controller.getState() === ClashState.Active;
    const actions = ais.map((ai) => ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
    for (const i of [0, 1]) {
      assertContract(actions[i]!, `${label} side ${i} tick ${tick}`);
      // Outside a Clash mash, a press that the system will ignore is spam.
      if (!clashActive) {
        if (actions[i]!.pressedThisFrame.has(Action.Attack) && beys[i]!.attack.getState() !== AttackState.Neutral) wastedPresses++;
        // An airborne Dodge press with an open air-recovery window is honored
        // by DodgeController regardless of the ground dodge's own state
        // (GDD section 21) — not spam.
        const airRecoveryPress = !isGrounded(physics, beys[i]!.collider) && beys[i]!.dodge.isAirRecoveryAvailable();
        if (actions[i]!.pressedThisFrame.has(Action.Dodge) && beys[i]!.dodge.getState() !== DodgeState.Idle && !airRecoveryPress) wastedPresses++;
      }
    }

    const result = tickMatch(physics, beys[0], beys[1], actions[0]!, actions[1]!, FIXED_DELTA_SECONDS, round, clash);

    for (const hit of result.hitEvents) {
      if (hit.caughtOpponentDashing) totals[pairing[hit.attackerIsFirst ? 0 : 1]].counters++;
    }
    for (const i of [0, 1]) {
      const snapshot = i === 0 ? result.first : result.second;
      const key = pairing[i]!;
      totals[key].seconds += FIXED_DELTA_SECONDS;
      if (ais[i]!.getDebugState().activeIntent === 'Circle') totals[key].circleSeconds += FIXED_DELTA_SECONDS;
      for (const value of [snapshot.staminaFraction, snapshot.stabilityFraction, snapshot.attackEnergyFraction, snapshot.movement.speedMps]) {
        assertFinite(value, `${label} side ${i} tick ${tick} resources/speed`);
      }
      const position = beys[i]!.body.translation();
      assertFinite(position.x + position.y + position.z, `${label} side ${i} tick ${tick} position`);

      if (snapshot.attackState !== previousAttackState[i]) {
        ticksInAttackState[i] = 0;
        if (snapshot.attackState === AttackState.Buffering) lastAttackStartTick = tick;
        if (snapshot.attackState === AttackState.DashActive) {
          dashes[i as 0 | 1]++;
          totals[key].dashes++;
        }
      }
      if (snapshot.attackState !== AttackState.Neutral && !clashActive && clash.controller.getState() !== ClashState.Active) {
        ticksInAttackState[i]!++;
        longestSingleAttackStateTicks = Math.max(longestSingleAttackStateTicks, ticksInAttackState[i]!);
      }
      previousAttackState[i] = snapshot.attackState;

      if (!clashActive) {
        const debug = ais[i]!.getDebugState();
        const inDashRange = debug.distanceToOpponentM > AI_CIRCULAR_ATTACK_RANGE_M && debug.distanceToOpponentM <= AI_DASH_ATTACK_MAX_RANGE_M;
        const canAttack = snapshot.attackState === AttackState.Neutral && snapshot.attackEnergyFraction > 0.25;
        if (dashes[i as 0 | 1] >= 1 && debug.activeIntent === 'AttackDash' && canAttack && inDashRange) wantedDashAgainTicks[i as 0 | 1]++;
        const wantsToAttack = debug.activeIntent === 'AttackDash' || debug.activeIntent === 'AttackCircular';
        const stalled = wantsToAttack && canAttack && debug.distanceToOpponentM <= AI_DASH_ATTACK_MAX_RANGE_M && !actions[i]!.held.has(Action.Attack);
        stalledAttackTicks[i] = stalled ? stalledAttackTicks[i]! + 1 : 0;
        longestStalledAttackTicks = Math.max(longestStalledAttackTicks, stalledAttackTicks[i]!);
      }
    }
    // A Clash freezes the whole simulation for its presentation — not passivity.
    if (clashActive) lastAttackStartTick = tick;
    if (!clashActive) playTicks++;
    maxNoAttackGapTicks = Math.max(maxNoAttackGapTicks, tick - lastAttackStartTick);
  }

  return {
    label,
    result: round.result,
    seconds: tick / 60,
    playSeconds: playTicks / 60,
    dashes,
    wantedDashAgainS: [wantedDashAgainTicks[0] / 60, wantedDashAgainTicks[1] / 60],
    longestStalledAttackS: longestStalledAttackTicks / 60,
    maxNoAttackGapS: maxNoAttackGapTicks / 60,
    longestSingleAttackStateS: longestSingleAttackStateTicks / 60,
    wastedPresses,
  };
}

describe('AI vs AI batch self-test (M7 Part 2)', () => {
  it('every archetype pairing resolves without degenerate behavior, and the archetypes play observably differently', async () => {
    const emptyTotals = (): ArchetypeTotals => ({ seconds: 0, dashes: 0, counters: 0, circleSeconds: 0 });
    const totals: Record<ArchetypeKey, ArchetypeTotals> = { attack: emptyTotals(), defense: emptyTotals(), stamina: emptyTotals() };
    const reports: MatchReport[] = [];
    for (const pairing of PAIRINGS) {
      for (const seed of SEEDS) reports.push(await runMatch(pairing, seed, totals));
    }

    const perMinute = (count: number, t: ArchetypeTotals) => (count / t.seconds) * 60;
    console.log(
      [
        'AI batch report (headless tickMatch only):',
        ...reports.map(
          (r) =>
            `  ${r.label}: ${r.result} in ${r.seconds.toFixed(1)}s, dashes ${r.dashes.join('/')}, max no-attack gap ${r.maxNoAttackGapS.toFixed(1)}s, wasted presses ${r.wastedPresses}`,
        ),
        ...(Object.keys(totals) as ArchetypeKey[]).map(
          (k) =>
            `  ${k}: ${perMinute(totals[k].dashes, totals[k]).toFixed(1)} dashes/min, ${perMinute(totals[k].counters, totals[k]).toFixed(2)} counters/min, Circle ${((100 * totals[k].circleSeconds) / totals[k].seconds).toFixed(0)}% of ${totals[k].seconds.toFixed(0)}s`,
        ),
      ].join('\n'),
    );

    for (const r of reports) {
      expect(r.result, `${r.label}: match must resolve within ${MAX_MATCH_S}s`).not.toBe('Ongoing');
      expect(r.maxNoAttackGapS, `${r.label}: passivity`).toBeLessThanOrEqual(MAX_NO_ATTACK_GAP_S);
      expect(r.longestSingleAttackStateS, `${r.label}: stuck attack state`).toBeLessThanOrEqual(MAX_SINGLE_ATTACK_STATE_S);
      expect(r.wastedPresses, `${r.label}: presses the system ignores (spam)`).toBe(0);
      for (const i of [0, 1] as const) {
        if (r.wantedDashAgainS[i] >= DASH_REARM_WANT_S) {
          expect(r.dashes[i], `${r.label} side ${i}: wanted another Dash for ${r.wantedDashAgainS[i].toFixed(1)}s but dashed only once`).toBeGreaterThanOrEqual(2);
        }
      }
      expect(r.longestStalledAttackS, `${r.label}: wanted to attack for ${r.longestStalledAttackS.toFixed(2)}s without pressing Attack`).toBeLessThanOrEqual(MAX_STALLED_ATTACK_S);
    }

    // GDD section 64: Attack seeks engagement / uses charge; Defense uses
    // counter opportunities; Stamina is the most patient.
    expect(perMinute(totals.attack.dashes, totals.attack)).toBeGreaterThan(1.5 * perMinute(totals.stamina.dashes, totals.stamina));
    expect(perMinute(totals.defense.counters, totals.defense)).toBeGreaterThan(1.5 * perMinute(totals.attack.counters, totals.attack));
    expect(totals.stamina.circleSeconds / totals.stamina.seconds).toBeGreaterThan(2 * (totals.attack.circleSeconds / totals.attack.seconds));
  }, 120000);
});
