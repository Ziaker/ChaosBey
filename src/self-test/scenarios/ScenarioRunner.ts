// ============================================================
// SCENARIO RUNNER (GDD sections 66, 68)
// Runs GDD 68 presets headless on the shared Self-Test core
// (SelfTestMatchWorld — the real tickMatch, one fixed tick at a time),
// scripted-controller vs scripted-controller, with the GDD 67 anomaly
// detector watching every tick. Same preset, same result: nothing here is
// random.
// ============================================================

import { ClashState } from '../../combat/clash/ClashController';
import { IdleController } from '../../automation/scripted-scenarios/IdleController';
import { ScriptedController } from '../../automation/scripted-scenarios/ScriptedController';
import type { CombatController } from '../../input/actions/Action';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../bey/archetype/BeyArchetypes';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import { NullAiMashSource } from '../../combat/clash/ClashMash';
import { FIXED_DELTA_SECONDS } from '../../physics/fixed-step/FixedTimestepLoop';
import { AIController } from '../../ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../ai/difficulty/AiDifficultyProfile';
import { personalityForBeyDefinitionId } from '../../ai/personalities/AiArchetypePersonalities';
import { createRngStreams } from '../../rng/SeededRng';
import { matchSpawnsFor } from '../../app/bootstrap/matchSpawns';
import { floorRimHeight, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import type { ChaosBeyReplayV1 } from '../../replay/format/ChaosBeyReplayV1';
import { startHeadlessCapture, type HeadlessCaptureInput } from '../../replay/recording/ReplayCapture';
import { SelfTestMatchWorld } from '../SelfTestMatchWorld';
import { DEFAULT_ANOMALY_THRESHOLDS, MatchAnomalyDetector, type DetectedAnomaly } from '../anomalies/MatchAnomalyDetector';
import { arenaFloorOf, resolveMatchConfig } from '../../config/match/MatchConfig';
import { SCENARIO_PRESETS, type ScenarioPreset, type ScenarioSideScript } from './ScenarioPresets';
import { createScenarioTrace, recordScenarioTick, type ScenarioTrace } from './ScenarioTrace';

export interface ScenarioRunOptions {
  /** Defaults: attack-prototype first, defense-prototype second (the live pairing). */
  readonly firstDefinition?: BeyDefinition;
  readonly secondDefinition?: BeyDefinition;
  /**
   * GDD 66 "scripted-controller vs AI": replace this side's script with the
   * real AIController (its archetype personality, seeded from the preset
   * id). The preset's own check then describes what happened but no longer
   * decides pass/fail — an AI need not play the script's part; a run
   * passes when it neither crashes nor hits an invalid state.
   */
  readonly aiSide?: 'first' | 'second';
  /** M11 lane 4: play the scenario on this floor profile (default flat). */
  readonly arenaFloor?: ArenaFloorId;
  /**
   * M9: record the run as a ChaosBeyReplayV1 (returned in
   * ScenarioResult.replay). Recording starts after the preset's setup, so
   * the replay's first checkpoint is the post-setup state: playing it back
   * needs the same setup applied first (the checkpoint at TicksCompleted 0
   * verifies that).
   */
  readonly record?: Omit<HeadlessCaptureInput, 'seedText' | 'spawns'>;
}

export interface ScenarioResult {
  readonly id: string;
  readonly label: string;
  readonly status: 'passed' | 'failed' | 'unsupported';
  readonly detail: string;
  readonly ticks: number;
  /** GDD 67 detections during the run (any invalid state also fails the scenario). */
  readonly detections: readonly DetectedAnomaly[];
  readonly crashMessage: string | null;
  /** Present when the run was recorded and didn't crash (M9). */
  readonly replay?: ChaosBeyReplayV1;
}

export interface ScenarioSuiteReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly unsupported: number;
  readonly results: readonly ScenarioResult[];
}

export function controllerForScript(side: ScenarioSideScript): CombatController {
  return side.kind === 'script' ? new ScriptedController([...side.frames]) : new IdleController();
}

export async function runScenario(preset: ScenarioPreset, options: ScenarioRunOptions = {}): Promise<ScenarioResult> {
  if (!preset.supported) {
    return { id: preset.id, label: preset.label, status: 'unsupported', detail: preset.unsupportedReason ?? 'unsupported', ticks: 0, detections: [], crashMessage: null };
  }
  if (preset.run) {
    try {
      const outcome = await preset.run();
      return { id: preset.id, label: preset.label, status: outcome.passed ? 'passed' : 'failed', detail: outcome.detail, ticks: outcome.ticks, detections: [], crashMessage: null };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return { id: preset.id, label: preset.label, status: 'failed', detail: `crashed: ${message}`, ticks: 0, detections: [], crashMessage: message };
    }
  }
  const floor = options.arenaFloor ?? 'flat';
  const matchConfig = resolveMatchConfig({ ...preset.matchConfig, arenaFloor: floor });
  const world = await SelfTestMatchWorld.build({
    firstDefinition: options.firstDefinition ?? ATTACK_ARCHETYPE,
    secondDefinition: options.secondDefinition ?? DEFENSE_ARCHETYPE,
    aiMashSource: new NullAiMashSource(),
    matchConfigOverrides: matchConfig,
  });
  const detections: DetectedAnomaly[] = [];
  let trace: ScenarioTrace = createScenarioTrace(world.first);
  try {
    preset.setup?.({ first: world.first, second: world.second });
    trace = createScenarioTrace(world.first);
    // RNG scheme 2 (M9): per-side AI streams from the preset id as root seed.
    const rng = createRngStreams(preset.id);
    const aiFor = (side: 'first' | 'second'): CombatController => {
      const own = side === 'first' ? world.first : world.second;
      const opponent = side === 'first' ? world.second : world.first;
      return new AIController(world.physics, own, opponent, world.clash.controller, personalityForBeyDefinitionId(own.definition.id), DEFAULT_AI_DIFFICULTY_PROFILE, side === 'first' ? rng.aiFirst : rng.aiSecond);
    };
    const first = options.aiSide === 'first' ? aiFor('first') : controllerForScript(preset.first);
    const second = options.aiSide === 'second' ? aiFor('second') : controllerForScript(preset.second);
    const detector = new MatchAnomalyDetector({ ...DEFAULT_ANOMALY_THRESHOLDS, wallHeightM: floorRimHeight(arenaFloorOf(matchConfig)) + matchConfig.arenaWallHeightM });
    const capture = options.record ? startHeadlessCapture(world, { ...options.record, seedText: preset.id, spawns: matchSpawnsFor(arenaFloorOf(matchConfig)), matchConfig }) : null;
    for (let tick = 0; tick < preset.durationTicks; tick++) {
      const clashStateBefore: ClashState = world.clash.controller.getState();
      // The same per-tick step as a live match, hitstop included (M9).
      const { firstActions, secondActions, result, advanced } = world.step({ first, second });
      capture?.afterTick(tick, firstActions, secondActions);
      recordScenarioTick(trace, { tick, first: world.first, second: world.second, result, roundState: world.roundState, clash: world.clash.controller, clashStateBefore, advanced });
      detections.push(
        ...detector.check({
          tick,
          first: world.first,
          second: world.second,
          result,
          roundState: world.roundState,
          clash: world.clash.controller,
          firstActions,
          secondActions,
          aiSides: { first: options.aiSide === 'first', second: options.aiSide === 'second' },
          hitstopActive: !advanced,
        }),
      );
      if (preset.doneWhen?.(trace) || world.roundState.isOver) break;
    }
    const check = preset.check(trace);
    const invalid = detections.filter((d) => d.severity === 'invalid-state');
    const checkDecides = options.aiSide === undefined;
    const passed = (checkDecides ? check.passed : true) && invalid.length === 0;
    const checkText = checkDecides ? check.detail : `vs AI (${options.aiSide}) — scripted expectation ${check.passed ? 'met' : 'not met'}: ${check.detail}`;
    const detail = invalid.length === 0 ? checkText : `${checkText}; invalid states: ${invalid.map((d) => d.kind).join(', ')}`;
    return {
      id: preset.id,
      label: preset.label,
      status: passed ? 'passed' : 'failed',
      detail,
      ticks: trace.ticks,
      detections,
      crashMessage: null,
      ...(capture ? { replay: capture.finish() } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { id: preset.id, label: preset.label, status: 'failed', detail: `crashed: ${message}`, ticks: trace.ticks, detections, crashMessage: message };
  } finally {
    world.dispose();
  }
}

export async function runScenarioSuite(presets: readonly ScenarioPreset[] = SCENARIO_PRESETS, options: ScenarioRunOptions = {}): Promise<ScenarioSuiteReport> {
  const results: ScenarioResult[] = [];
  for (const preset of presets) results.push(await runScenario(preset, options));
  return {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    unsupported: results.filter((r) => r.status === 'unsupported').length,
    results,
  };
}
