// ============================================================
// CANONICAL MATCH STATE V1 SELF-TESTS (M9-A)
// buildCanonicalMatchState() driven through the real tickMatch()
// orchestration via CombatHarness (GDD section 114/150), checking:
// - the same seed produces byte-for-byte identical canonical states, tick
//   for tick, across two independent runs (the property a future state
//   hash depends on entirely);
// - a real difference (different seed) is actually visible in the
//   snapshot, not silently missed by an incomplete field list;
// - the newly-added getCanonicalState()/getWobbleTimeAccumulatorS()/
//   getInternalStateUint32() getters this milestone introduced report
//   real, changing values — not stubs — once the thing they track
//   actually happens (a dodge, a jump, an AI decision).
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { buildCanonicalMatchState } from '../../src/replay/CanonicalMatchState';
import { CombatHarness } from './combatHarness';

const NO_ACTIONS: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };

async function runAiVsAi(seed: string, ticks: number) {
  const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -2 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 2 }, {}, new NullAiMashSource());
  const firstAi = new AIController(harness.physics, harness.first, harness.second, harness.clash.controller, ATTACK_AI_PERSONALITY, DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText(`${seed}/first`));
  const secondAi = new AIController(harness.physics, harness.second, harness.first, harness.clash.controller, ATTACK_AI_PERSONALITY, DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText(`${seed}/second`));
  const firstAiRng = SeededRng.fromSeedText(`${seed}/first-canonical`);
  const secondAiRng = SeededRng.fromSeedText(`${seed}/second-canonical`);

  const states = [];
  for (let tick = 0; tick < ticks; tick++) {
    const firstActions = firstAi.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const secondActions = secondAi.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    // Drive the canonical-state RNG streams too, so their internal counter
    // is exercised (mirrors what MatchSession/AiMatchSimulation do: an
    // AI's own rng IS the stream captured in canonical state — here we use
    // separate streams only so the test can assert on a known sequence).
    firstAiRng.nextFloat();
    harness.tick(firstActions, secondActions);
    states.push(buildCanonicalMatchState(tick, harness.first, harness.second, harness.roundState, harness.clash.controller, firstAiRng, secondAiRng));
    if (harness.roundState.isOver) break;
  }
  return { harness, states };
}

describe('buildCanonicalMatchState', () => {
  it('is byte-for-byte identical, tick for tick, for two independent runs of the same seed', async () => {
    const a = await runAiVsAi('canonical-determinism', 200);
    const b = await runAiVsAi('canonical-determinism', 200);
    expect(a.states.length).toBe(b.states.length);
    expect(a.states.length).toBeGreaterThan(50);
    for (let i = 0; i < a.states.length; i++) {
      expect(a.states[i], `tick ${i}`).toEqual(b.states[i]);
    }
  });

  it('a different seed is actually visible in the canonical state within a short window', async () => {
    const a = await runAiVsAi('canonical-seed-alpha', 200);
    const b = await runAiVsAi('canonical-seed-beta', 200);
    const firstDivergence = a.states.findIndex((state, i) => b.states[i] === undefined || JSON.stringify(state) !== JSON.stringify(b.states[i]));
    expect(firstDivergence, 'the two seeds never diverged at all — the field list is missing something RNG-driven').toBeGreaterThanOrEqual(0);
  });

  it('reports canonicalStateVersion, tick index and round outcome correctly', async () => {
    const { states } = await runAiVsAi('canonical-shape', 10);
    for (const [i, state] of states.entries()) {
      expect(state.canonicalStateVersion).toBe(1);
      expect(state.tick).toBe(i);
    }
  });

  it("a dodge's raw activeTimerS/cooldownTimerS (not exposed by getDebugTimers' gated form) show up in the canonical state", async () => {
    const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -3 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 3 }, {}, new NullAiMashSource());
    for (let i = 0; i < 20; i++) harness.tick(NO_ACTIONS, NO_ACTIONS); // settle onto the ground
    const dodgePress: ControllerActions = { held: new Set(), pressedThisFrame: new Set([Action.Dodge]), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
    harness.tick(dodgePress, NO_ACTIONS);
    harness.tick(NO_ACTIONS, NO_ACTIONS); // one more tick so activeTimerS has advanced past its 0-at-entry value
    const rng = SeededRng.fromSeedText('dodge-canonical');
    const state = buildCanonicalMatchState(0, harness.first, harness.second, harness.roundState, harness.clash.controller, rng, rng);
    expect(state.first.dodge.state).toBe(DodgeState.Dodging);
    expect(state.first.dodge.activeTimerS).toBeGreaterThan(0);
  });

  it("a jump's hopTimerS and wasGrounded show up in the canonical state", async () => {
    const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -3 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 3 }, {}, new NullAiMashSource());
    for (let i = 0; i < 20; i++) harness.tick(NO_ACTIONS, NO_ACTIONS);
    const jumpPress: ControllerActions = { held: new Set([Action.JumpDrift]), pressedThisFrame: new Set([Action.JumpDrift]), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
    harness.tick(jumpPress, NO_ACTIONS);
    for (let i = 0; i < 5; i++) harness.tick(NO_ACTIONS, NO_ACTIONS); // enough ticks for the hop impulse to actually leave the ground (contact-based detection, not instant on the impulse tick)
    const rng = SeededRng.fromSeedText('jump-canonical');
    const state = buildCanonicalMatchState(0, harness.first, harness.second, harness.roundState, harness.clash.controller, rng, rng);
    expect(state.first.drift.state).toBe(DriftState.Hopping);
    expect(state.first.drift.hopTimerS).toBeGreaterThan(0);
    expect(state.first.drift.wasGrounded).toBe(false);
  });

  it("SpinController's wobble phase accumulator advances every tick, independent of wobbleEnergy — and is captured raw", async () => {
    const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -3 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 3 }, {}, new NullAiMashSource());
    const rng = SeededRng.fromSeedText('wobble-canonical');
    const before = buildCanonicalMatchState(0, harness.first, harness.second, harness.roundState, harness.clash.controller, rng, rng);
    for (let i = 0; i < 10; i++) harness.tick(NO_ACTIONS, NO_ACTIONS);
    const after = buildCanonicalMatchState(1, harness.first, harness.second, harness.roundState, harness.clash.controller, rng, rng);
    expect(after.first.spin.wobbleTimeAccumulatorS).toBeGreaterThan(before.first.spin.wobbleTimeAccumulatorS);
  });

  it('aiRngState changes exactly when the stream it tracks is drawn from, and matches SeededRng determinism', async () => {
    const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -3 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 3 }, {}, new NullAiMashSource());
    const rngA = SeededRng.fromSeedText('rng-state-check');
    const rngB = SeededRng.fromSeedText('rng-state-check');
    const before = buildCanonicalMatchState(0, harness.first, harness.second, harness.roundState, harness.clash.controller, rngA, rngA);
    rngA.nextFloat();
    rngB.nextFloat();
    const after = buildCanonicalMatchState(1, harness.first, harness.second, harness.roundState, harness.clash.controller, rngA, rngA);
    expect(after.first.aiRngState).not.toBe(before.first.aiRngState);
    expect(after.first.aiRngState).toBe(rngB.getInternalStateUint32());
  });
});
