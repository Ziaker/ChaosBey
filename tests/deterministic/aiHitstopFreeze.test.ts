// ============================================================
// AI UNDER HITSTOP — FREEZE VALIDATION (MILESTONE 7 PART 2b)
// The hitstop freeze lives in main.ts (the camera decides it; main.ts
// samples every controller with simulationFrozen and skips tickMatch while
// it lasts). main.ts itself can't run headless, so this replays its
// normal-path sequence exactly, with the real CombatCameraController
// deciding the freeze from real impact events:
//   frozen = lastCameraOutput.isHitstopActive
//   actions = controllers.sampleActions({ simulationFrozen: frozen })
//   result = frozen ? lastResult : tickMatch(...)
//   camera.tick(impact events — none while frozen)
// Two AIs fight; every freeze window is checked pre-freeze -> freeze ->
// first post-freeze tick, and the whole run is compared with a twin run
// that never freezes: if the freeze is transparent to the AI, the
// non-frozen ticks match tick for tick (actions, hold clocks, intents).
//
// Not covered here (limitations): main.ts's Clash branches (the Clash
// camera and the resolution-beat hitstop) — the run stops at the first
// Active Clash; and main.ts itself, which the Chromium smoke
// (tests/smoke/aiRuntime.spec.ts) exercises through a real hitstop.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import type { AiDebugState } from '../../src/ai/debug/AiDebugState';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { CombatCameraController, type CombatCameraOutput } from '../../src/camera/CombatCameraController';
import { buildImpactEventsForTick } from '../../src/camera/ImpactEvents';
import type { MatchTickResult } from '../../src/app/simulation/tickMatch';
import { ClashState } from '../../src/combat/clash/ClashController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import type { ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const MAX_TICKS = 40 * 60;
const MIN_FREEZE_WINDOWS = 2;

interface Sample {
  actions: ControllerActions;
  heldSnapshot: string[];
  pressedSnapshot: string[];
  debug: AiDebugState;
}

interface TickLog {
  frozen: boolean;
  samples: [Sample, Sample];
}

const sorted = (set: ReadonlySet<string>) => [...set].sort();

async function runMatch(withHitstop: boolean, seed: string) {
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: -2.5 }, { x: 0, y: 0.5, z: 2.5 }, {}, new NullAiMashSource());
  const ais = [
    new AIController(harness.physics, harness.first, harness.second, harness.clash.controller, ATTACK_AI_PERSONALITY, DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText(`${seed}-0`)),
    new AIController(harness.physics, harness.second, harness.first, harness.clash.controller, DEFENSE_AI_PERSONALITY, DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText(`${seed}-1`)),
  ] as const;
  const camera = new CombatCameraController();
  let lastCamera: CombatCameraOutput | null = null;
  let lastResult: MatchTickResult | null = null;
  const log: TickLog[] = [];

  for (let tick = 0; tick < MAX_TICKS && !harness.roundState.isOver; tick++) {
    // The replica covers main.ts's normal path only (see header).
    if (harness.clash.controller.getState() === ClashState.Active) break;
    const frozen = withHitstop && (lastCamera?.isHitstopActive ?? false);
    const samples = ais.map((ai) => {
      const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS, simulationFrozen: frozen });
      return { actions, heldSnapshot: sorted(actions.held), pressedSnapshot: sorted(actions.pressedThisFrame), debug: ai.getDebugState() };
    }) as [Sample, Sample];
    let result: MatchTickResult;
    if (frozen && lastResult) {
      result = lastResult;
    } else {
      result = harness.tick(samples[0].actions, samples[1].actions);
      lastResult = result;
    }
    const firstPositionM = harness.first.body.translation();
    const secondPositionM = harness.second.body.translation();
    lastCamera = camera.tick({
      firstPositionM,
      secondPositionM,
      firstSpeedMps: result.first.movement.speedMps,
      secondSpeedMps: result.second.movement.speedMps,
      firstVelocityXZ: result.first.movement.actualVelocityVector,
      impactEvents: frozen ? [] : buildImpactEventsForTick(result, firstPositionM, secondPositionM),
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
    });
    log.push({ frozen, samples });
  }
  return log;
}

/** [start, end) index ranges of consecutive frozen ticks, each with a pre-freeze tick before and a post-freeze tick after. */
function freezeWindows(log: readonly TickLog[]): [number, number][] {
  const windows: [number, number][] = [];
  for (let i = 1; i < log.length; i++) {
    if (!log[i]!.frozen || log[i - 1]!.frozen) continue;
    let end = i;
    while (end < log.length && log[end]!.frozen) end++;
    if (end < log.length) windows.push([i, end]);
  }
  return windows;
}

describe('AI under hitstop (M7 Part 2b)', () => {
  it('pre-freeze -> freeze -> first post-freeze tick: held kept, no presses, clocks and commitments frozen; the freeze is transparent to the AI', async () => {
    const seed = 'hitstop-freeze';
    const withFreeze = await runMatch(true, seed);
    const windows = freezeWindows(withFreeze);
    expect(windows.length, 'real hits froze the simulation').toBeGreaterThanOrEqual(MIN_FREEZE_WINDOWS);

    for (const [start, end] of windows) {
      for (const side of [0, 1] as const) {
        const pre = withFreeze[start - 1]!.samples[side];
        const post = withFreeze[end]!.samples[side];
        for (let i = start; i < end; i++) {
          const frozen = withFreeze[i]!.samples[side];
          const at = `side ${side}, freeze tick ${i - start + 1}/${end - start}`;
          expect(frozen.heldSnapshot, `${at}: held preserved`).toEqual(pre.heldSnapshot);
          expect(frozen.pressedSnapshot, `${at}: no presses while frozen`).toEqual([]);
          // Hold clocks: constant through the freeze (they read the next tick's value, then stay).
          expect(frozen.actions.attackHoldDurationSeconds, `${at}: attack hold clock frozen`).toBe(withFreeze[start]!.samples[side].actions.attackHoldDurationSeconds);
          expect(frozen.actions.jumpDriftHoldDurationSeconds, `${at}: jump hold clock frozen`).toBe(withFreeze[start]!.samples[side].actions.jumpDriftHoldDurationSeconds);
          // Reaction timer, pending slow reaction, and the decision/commitment in force: untouched.
          expect(frozen.debug.reactionTimerS, `${at}: reaction timer not advancing`).toBe(pre.debug.reactionTimerS);
          expect(frozen.debug.pendingRemainingS, `${at}: pending delay not advancing`).toBe(pre.debug.pendingRemainingS);
          expect(frozen.debug.activeIntent, `${at}: decision/commitment kept`).toBe(pre.debug.activeIntent);
        }
        // First post-freeze tick: nothing held through the freeze is pressed again.
        for (const action of post.pressedSnapshot) {
          expect(pre.heldSnapshot, `side ${side}: ${action} pressed again after the freeze`).not.toContain(action);
        }
        // Attack held into the freeze and still wanted after it: no release caused by the freeze.
        if (pre.heldSnapshot.includes('Attack') && post.debug.activeIntent === pre.debug.activeIntent && post.heldSnapshot.includes('Attack')) {
          expect(post.pressedSnapshot).not.toContain('Attack');
        }
      }
    }

    // Transparency: drop the frozen ticks and the run is the no-freeze twin, tick for tick.
    const twin = await runMatch(false, seed);
    const unfrozen = withFreeze.filter((entry) => !entry.frozen);
    // Same number of simulated ticks: the round ends (or a Clash starts) on the same one.
    expect(unfrozen.length, 'the freezes changed how long the fight lasted').toBe(twin.length);
    const compared = unfrozen.length;
    for (let i = 0; i < compared; i++) {
      for (const side of [0, 1] as const) {
        const a = unfrozen[i]!.samples[side];
        const b = twin[i]!.samples[side];
        const at = `simulated tick ${i}, side ${side}`;
        expect(a.heldSnapshot, `${at}: held`).toEqual(b.heldSnapshot);
        expect(a.pressedSnapshot, `${at}: pressed`).toEqual(b.pressedSnapshot);
        expect(a.actions.attackHoldDurationSeconds, `${at}: attack hold clock`).toBe(b.actions.attackHoldDurationSeconds);
        expect(a.debug.activeIntent, `${at}: intent`).toBe(b.debug.activeIntent);
        expect(a.debug.reactionTimerS, `${at}: reaction timer`).toBe(b.debug.reactionTimerS);
      }
    }
  });
});
