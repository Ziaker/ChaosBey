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
// Re-swept with each gameplay lote of the owner's 2026-10-02 request (ring-out
// delay and Perfect Dodge once, Dash cooldown, momentum, jump, combat rules):
// after Lote 5, replay-0..599 has 19 qualifying; replay-56 (2610 ticks, 161
// frozen) and replay-51 (2304 ticks, 127 frozen, 682 steering ticks after 900).
// Owner audit fixes, 2026-10-03 (a Dash press kept through a recovery, Dash readiness, body-collision tie/latch,
// the Bey-Bey bumper filter really running, the jump's deferred launch, the AI's 45-Stamina dodge reserve) change
// every AI fight from its first jump or contact on. Swept replay-0..239 with the same criteria: 16 qualify;
// replay-198 (2668 ticks, 151 frozen) and replay-18 (2666 ticks, 119 frozen, 717 steering ticks after 900).
// Most seeds end within a few hundred ticks.
// Seeds re-picked for item 11 (owner, 2026-10-04): faster hits deal more damage, so 'replay-198' now ends at tick 966
// and 'replay-18' at ~70 hitstop ticks — under expectSubstantial. These two are long-enough matches under the
// new rule with a comfortable margin (seed scan replay-0..59: 2448 / 2406 ticks, 137 / 141 hitstop ticks). The checks themselves are unchanged.
// Re-picked in the owner audit (2026-10-04, hitstop on hits only): replay-37 (2876 ticks, 28 frozen) and replay-3
// (3118 ticks, 25 frozen, 1382 steering ticks after 900), from a scan of replay-0..79.
// Re-picked again for 0.39.0 (owner, 2026-10-05: one Perfect Dodge per dodge, no dodge/attack cancels, dodge cooldown
// 1.25 s changed every fight): replay-40 (2063 ticks, 22 frozen) and replay-11 (2001 ticks, 21 frozen, 538 steering
// ticks after 900), from a scan of replay-0..119.
// And for 0.41.0 (owner, 2026-10-05: no Air Recovery after a lost Clash): replay-4 (1945 ticks, 28 frozen) and
// replay-38 (1794 ticks, 22 frozen, 700 steering ticks after 900), from a scan of replay-0..119.
// And for 0.42.0 (owner, 2026-10-05: intangible dodge, recovery time, drift): replay-46 (2628 ticks, 22 frozen) and
// replay-100 (2147 ticks, 21 frozen, 717 steering ticks after 900), from a scan of replay-0..119 (4 qualify).
// 0.43.1 (owner, 2026-10-05: the drift carves its turns): replay-46 fell to 16 frozen ticks; replay-158 (2516 ticks, 32
// frozen) from a scan of replay-0..159 (7 qualify). replay-100 still qualifies unchanged.
const LONG_SEED = 'replay-158';
const MUTATION_SEED = 'replay-100';

/** A recording that really exercises the path: long, and frozen on hitstop at least 100 times. */
function expectSubstantial(recording: Recording): void {
  expect(recording.frames.first.length).toBeGreaterThan(1000);
  // 20 (was 100) since the owner audit (2026-10-04): wall/rim impacts and landings no longer freeze the match, only
  // hits do — the most of replay-0..79 is 28 frozen ticks. Still a real share of hitstop for the replay to reproduce.
  expect(recording.advanced.filter((ran) => !ran).length).toBeGreaterThanOrEqual(20);
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


it('scan', async () => {
  const rows: string[] = [];
  for (let n = 0; n < 120; n++) {
    const seed = `replay-${n}`;
    const rec = await recordLiveAiMatch(seed, 3600);
    const ticks = rec.frames.first.length;
    const frozen = rec.advanced.filter((r) => !r).length;
    const steer = rec.firstSteers.filter((r, i) => i >= 900 && r).length;
    if (ticks > 1000 && frozen >= 20) rows.push(`${seed}: ${ticks} ticks, ${frozen} frozen, ${steer} steering after 900`);
  }
  console.log('## qualifying\n' + rows.join('\n'));
}, 3000000);
