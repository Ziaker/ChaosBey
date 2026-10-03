// M9 lane C: playback through the real runtime (ReplayController), checkpoint
// comparison and first-divergence location. Frames here are captured
// straight from a live MatchSession's tick outputs; the replay file format
// (lane B) is not needed to prove the playback path.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import type { SideControllerSpec } from '../../src/app/session/SideControllers';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { applyAttackProfileSettings, createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import type { StateCheckpoint } from '../../src/replay/contracts';
import { HeadlessReplayRun, type ReplayFrames } from '../../src/replay/playback/HeadlessReplayRun';
import { compareCheckpoints, locateFirstDivergence } from '../../src/replay/playback/divergence';
import { copyControllerActions, ReplayController, ReplayExhaustedError } from '../../src/replay/playback/ReplayController';
import { SelfTestMatchWorld } from '../../src/self-test/SelfTestMatchWorld';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

const AI_BOTH: { first: SideControllerSpec; second: SideControllerSpec } = { first: { kind: 'ai', personality: 'archetype' }, second: { kind: 'ai', personality: 'archetype' } };

async function liveSession(seedText: string, controllers: { first: SideControllerSpec; second: SideControllerSpec }): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  return MatchSession.create({
    scene,
    camera,
    seedText,
    matchConfig: resolveMatchConfig(),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers,
    keyboard: new IdleController(),
  });
}

/** Built the way the live session builds its match (same Beys, spawns, config, NullAiMashSource). */
async function headlessWorld(): Promise<SelfTestMatchWorld> {
  const profiles = createDefaultAttackProfileSettings();
  return SelfTestMatchWorld.build({
    firstDefinition: applyAttackProfileSettings(ATTACK_ARCHETYPE, profiles),
    secondDefinition: applyAttackProfileSettings(DEFENSE_ARCHETYPE, profiles),
    aiMashSource: new NullAiMashSource(),
  });
}

interface Recording {
  readonly frames: ReplayFrames;
  /** One checkpoint per TicksCompleted, 0 included. */
  readonly checkpoints: StateCheckpoint[];
  /** advanced[n]: whether TickIndex n ran tickMatch (false = hitstop froze it). */
  readonly advanced: boolean[];
  /**
   * firstSteers[n]: whether TickIndex n read the first Bey's movement input.
   * It doesn't on a frozen tick, during an Active Clash, while its attack
   * isn't Neutral (a Dash overrides movement), or in the post-impact window
   * where MovementController lets the collision's velocity play out.
   */
  readonly firstSteers: boolean[];
}

// Seeds pinned for long fights with many hitstop freezes (RNG scheme 2),
// re-pinned whenever the fights change: replay-15 / replay-17 before the
// Motion Lab integration (M11), replay-45 / replay-40 after it, replay-50
// after its follow-up fixes, replay-66 / replay-30 with the first
// owner-playtest controls, replay-41 / replay-64 with the drift fix,
// replay-3 / replay-4 with the dodge rewrite alone, replay-13 / replay-27
// with the movement/weight/dodge playtest pass's full set of changes,
// replay-99 with the jump/air-control hotfix's vertical-jump rewrite
// alone, and now, after that same hotfix's +20% air-control change (yet
// another AI-vs-AI dynamics shift, same section-20 principle: report the
// real consequence, don't mask it) — re-pinned once more: replay-62 lasts
// 1638 ticks with 140 frozen; replay-27 (the dodge-pass seed) still
// qualifies unchanged (now 1250 ticks, 180 frozen — AI dynamics shifted
// but it stayed well above the thresholds) and is kept as the
// mutation-path seed. Both still read the first Bey's movement input after
// tick 900.
// Arena scale pass (36 m bowl arena, the new default floor): every earlier
// seed changed again; a sweep of replay-0..99 found 7 that qualify (>1000
// ticks, >100 frozen). replay-0 lasts 1603 ticks with 139 frozen and
// replay-26 1544 with 128 frozen; both read the first Bey's movement input
// after tick 900 (252 and 107 ticks).
// Re-swept once more when the floor heightfield went 288 -> 144 cells (same
// arena, slightly different contact physics): replay-0 no longer qualifies;
// now only replay-58 (1103 ticks, 110 frozen) and replay-26 (1950 ticks, 104
// frozen, 449 steering ticks after tick 900) do.
// Ring-out delay + Perfect Dodge reported once per dodge (owner, 2026-10-02 —
// the per-tick Perfect Dodge repeats also re-triggered hitstop), the Dash
// cooldown (Lote 2), then momentum and body collisions (Lote 3): re-swept
// replay-0..599, only replay-487 qualifies (1621 ticks, 109 frozen, 189
// steering ticks after tick 900), so it serves both roles.
// Most seeds end within a few hundred ticks.
const LONG_SEED = 'replay-487';
const MUTATION_SEED = 'replay-487';

/** A recording that really exercises the path: long, and frozen on hitstop at least 100 times. */
function expectSubstantial(recording: Recording): void {
  expect(recording.frames.first.length).toBeGreaterThan(1000);
  expect(recording.advanced.filter((ran) => !ran).length).toBeGreaterThan(100);
}

/** Plays a live AI-vs-AI match and records what a replay recorder would: each tick's actions and state hash. */
async function recordLiveAiMatch(seed: string, maxTicks: number): Promise<Recording> {
  const live = await liveSession(seed, AI_BOTH);
  const first: ControllerActions[] = [];
  const second: ControllerActions[] = [];
  const advanced: boolean[] = [];
  const firstSteers: boolean[] = [];
  const checkpoints: StateCheckpoint[] = [{ ticksCompleted: 0, hash: live.getStateHash() }];
  for (let i = 0; i < maxTicks && !live.roundState.isOver; i++) {
    const firstBey = live.match.first;
    const readsMovement =
      live.clash.controller.getState() !== ClashState.Active &&
      firstBey.attack.getState() === AttackState.Neutral &&
      firstBey.movement.getDebugState().postImpactCooldownRemainingS === 0;
    const out = live.tick();
    expect(out.tickIndex).toBe(i);
    first.push(copyControllerActions(out.firstActions));
    second.push(copyControllerActions(out.secondActions));
    advanced.push(out.simulationAdvanced);
    firstSteers.push(out.simulationAdvanced && readsMovement);
    checkpoints.push({ ticksCompleted: i + 1, hash: live.getStateHash() });
  }
  live.dispose();
  return { frames: { first, second }, checkpoints, advanced, firstSteers };
}

function actions(held: Action[], pressed: Action[] = []): ControllerActions {
  return { held: new Set(held), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
}

describe('ReplayController', () => {
  it('answers TickIndex n with frame n, frozen or not, and refuses to run past the recording', () => {
    const frames = [actions([Action.MoveForward]), actions([], [Action.Dodge])];
    const controller = new ReplayController(frames, 'test');
    expect(controller.sampleActions().held.has(Action.MoveForward)).toBe(true);
    expect(controller.nextTickIndex).toBe(1);
    // A frozen tick still consumes its own frame: the recording already reflects the freeze.
    expect(controller.sampleActions().pressedThisFrame.has(Action.Dodge)).toBe(true);
    expect(controller.isExhausted()).toBe(true);
    expect(() => controller.sampleActions()).toThrow(ReplayExhaustedError);
    expect(() => controller.sampleActions()).toThrow(/TickIndex 2 \(recording has 2 frames\)/);
  });

  it('keeps its own copy, so a caller mutating the source Sets later changes nothing', () => {
    const held = new Set([Action.Attack]);
    const controller = new ReplayController([{ held, pressedThisFrame: new Set(), attackHoldDurationSeconds: 0.25, jumpDriftHoldDurationSeconds: 0 }]);
    held.clear();
    const frame = controller.sampleActions();
    expect(frame.held.has(Action.Attack)).toBe(true);
    expect(frame.attackHoldDurationSeconds).toBe(0.25);
  });
});

describe('compareCheckpoints', () => {
  const cp = (ticksCompleted: number, hash: string): StateCheckpoint => ({ ticksCompleted, hash });

  it('matches identical lists, in any order, and ignores extra actual checkpoints', () => {
    expect(compareCheckpoints([cp(60, 'b'), cp(0, 'a')], [cp(0, 'a'), cp(30, 'x'), cp(60, 'b')])).toEqual({ status: 'match', compared: 2 });
  });

  it('reports the divergence window: last match and first mismatch', () => {
    const result = compareCheckpoints([cp(0, 'a'), cp(60, 'b'), cp(120, 'c')], [cp(0, 'a'), cp(60, 'b'), cp(120, 'Z')]);
    expect(result).toEqual({ status: 'diverged', compared: 3, lastMatch: 60, firstMismatch: { ticksCompleted: 120, expected: 'c', actual: 'Z' } });
    expect(compareCheckpoints([cp(0, 'a')], [cp(0, 'b')])).toMatchObject({ status: 'diverged', lastMatch: null });
  });

  it('says incomplete when the playback stopped before an expected checkpoint', () => {
    expect(compareCheckpoints([cp(0, 'a'), cp(60, 'b')], [cp(0, 'a')])).toEqual({ status: 'incomplete', compared: 1, missing: 60 });
  });

  it('refuses a list with the same TicksCompleted twice', () => {
    expect(() => compareCheckpoints([cp(0, 'a'), cp(0, 'a')], [])).toThrow(/two checkpoints at ticksCompleted 0/);
  });
});

describe('playback through the real runtime', () => {
  it('a recorded live AI-vs-AI match plays back headless with every checkpoint identical, hitstop included', async () => {
    const recording = await recordLiveAiMatch(LONG_SEED, 3600);
    expectSubstantial(recording);

    const run = new HeadlessReplayRun(await headlessWorld(), recording.frames);
    expect(run.length).toBe(recording.frames.first.length);
    const actual = run.playToEnd(1);
    expect(compareCheckpoints(recording.checkpoints, actual)).toEqual({ status: 'match', compared: recording.checkpoints.length });
    run.world.dispose();

    // Sparse checkpoints (the replay format stores these) agree too, final state included.
    const sparse = new HeadlessReplayRun(await headlessWorld(), recording.frames).playToEnd(60);
    expect(sparse.at(-1)?.ticksCompleted).toBe(recording.frames.first.length);
    expect(compareCheckpoints(sparse, recording.checkpoints)).toEqual({ status: 'match', compared: sparse.length });
  }, 180_000);

  it('the same recording plays back in a live MatchSession (replay controllers) with the identical hash every tick', async () => {
    const recording = await recordLiveAiMatch(LONG_SEED, 3600);
    expectSubstantial(recording);
    const replay = await liveSession('a-different-seed-does-not-matter', {
      first: { kind: 'replay', label: 'first', frames: recording.frames.first },
      second: { kind: 'replay', label: 'second', frames: recording.frames.second },
    });
    expect(replay.getStateHash()).toBe(recording.checkpoints[0]!.hash);
    for (let i = 0; i < recording.frames.first.length; i++) {
      replay.tick();
      expect(replay.getStateHash(), `ticksCompleted ${i + 1}`).toBe(recording.checkpoints[i + 1]!.hash);
    }
    // One tick past the recording is refused, not improvised.
    expect(() => replay.tick()).toThrow(ReplayExhaustedError);
    replay.dispose();
  }, 180_000);

  it('a single mutated input is caught at exactly the tick after it, by checkpoints and by the divergence locator', async () => {
    const recording = await recordLiveAiMatch(MUTATION_SEED, 3600);
    expectSubstantial(recording);
    // Late in the fight, on a tick whose movement input the game really reads.
    const k = recording.firstSteers.findIndex((reads, i) => i >= 900 && reads);
    expect(k).toBeGreaterThanOrEqual(900);
    const original = recording.frames.first[k]!;
    const held = new Set(original.held);
    if (held.has(Action.MoveForward)) held.delete(Action.MoveForward);
    else held.add(Action.MoveForward);
    const mutatedFirst = [...recording.frames.first];
    mutatedFirst[k] = { ...original, held };
    const mutated: ReplayFrames = { first: mutatedFirst, second: recording.frames.second };

    // Per-tick checkpoints: the window closes on the exact tick.
    const perTick = new HeadlessReplayRun(await headlessWorld(), mutated);
    expect(compareCheckpoints(recording.checkpoints, perTick.playToEnd(1))).toMatchObject({
      status: 'diverged',
      lastMatch: k,
      firstMismatch: { ticksCompleted: k + 1 },
    });
    perTick.world.dispose();

    // Sparse checkpoints only bound it; the locator then pins it down.
    const sparse = new HeadlessReplayRun(await headlessWorld(), mutated).playToEnd(60);
    const window = compareCheckpoints(sparse, recording.checkpoints);
    expect(window.status).toBe('diverged');
    if (window.status !== 'diverged') return;
    expect(window.lastMatch ?? 0).toBeLessThanOrEqual(k);
    expect(window.firstMismatch.ticksCompleted).toBeGreaterThanOrEqual(k + 1);

    const reference = new HeadlessReplayRun(await headlessWorld(), recording.frames);
    const suspect = new HeadlessReplayRun(await headlessWorld(), mutated);
    const report = locateFirstDivergence(reference, suspect, window.firstMismatch.ticksCompleted, window.lastMatch ?? 0);
    expect(report).toMatchObject({ status: 'diverged', ticksCompleted: k + 1, tickIndex: k });
    if (report.status === 'diverged') expect(report.paths.some((p) => p.startsWith('beys.first.'))).toBe(true);
    reference.world.dispose();
    suspect.world.dispose();
  }, 180_000);

  it('the locator reports identical runs as identical', async () => {
    const recording = await recordLiveAiMatch(LONG_SEED, 3600);
    const a = new HeadlessReplayRun(await headlessWorld(), recording.frames);
    const b = new HeadlessReplayRun(await headlessWorld(), recording.frames);
    expect(locateFirstDivergence(a, b, a.length)).toEqual({ status: 'identical', ticksCompared: a.length });
    a.world.dispose();
    b.world.dispose();
  }, 120_000);
});
