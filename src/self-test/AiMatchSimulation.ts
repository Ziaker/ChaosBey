// ============================================================
// AI VS AI MATCH SIMULATION — SELF-TEST CORE (M8)
// Runs one full round between two real AIControllers through the real match
// (SelfTestMatchWorld → tickMatch), and returns what happened: the outcome,
// a per-side behavior summary (what each AI chose, pressed and produced),
// physics anomalies and tick timing. GDD sections 66/67/114/162/163: AI vs
// AI is the self-test and regression workhorse. This is runtime code shared
// by the batch runner (AiBatchRunner.ts) and, through a thin adapter
// (tests/deterministic/aiMatchRunner.ts), by the deterministic suite; it
// holds no test framework or assertion code.
//
// Moved from tests/deterministic/aiMatchRunner.ts without changing how a
// match is seeded or simulated, so every existing seed plays the same fight.
// ============================================================

import { DEFAULT_ANOMALY_THRESHOLDS, MatchAnomalyDetector, type DetectedAnomaly } from './anomalies/MatchAnomalyDetector';
import { AIController } from '../ai/controllers/AIController';
import { AI_DASH_ATTACK_MAX_RANGE_M } from '../ai/decision/AiCombatRanges';
import { AiIntent } from '../ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE, type AiDifficultyProfile } from '../ai/difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../ai/personalities/AiPersonality';
import { personalityForBeyDefinitionId } from '../ai/personalities/AiArchetypePersonalities';
import { matchSpawnsFor, type SpawnPositionM } from '../app/bootstrap/matchSpawns';
import { floorRimHeight } from '../arena/floor/ArenaFloorProfile';
import type { ChaosBeyReplayV1 } from '../replay/format/ChaosBeyReplayV1';
import { startHeadlessCapture, type HeadlessCaptureInput } from '../replay/recording/ReplayCapture';
import { arenaFloorOf, resolveMatchConfig, type MatchConfig } from '../config/match/MatchConfig';
import type { BeyDefinition } from '../bey/archetype/BeyDefinition';
import { ARENA_FLOOR_RADIUS } from '../arena/colliders/ArenaTuning';
import { AttackState } from '../combat/attacks/AttackController';
import { ClashState } from '../combat/clash/ClashController';
import { NullAiMashSource } from '../combat/clash/ClashMash';
import { RoundOutcome } from '../combat/round-rules/RoundState';
import { DodgeState } from '../dodge/DodgeController';
import { Action, type ControllerActions } from '../input/actions/Action';
import { checkAngularVelocity, checkLinearVelocity, type PhysicsAnomaly } from '../physics/diagnostics/physicsSafety';
import { FIXED_DELTA_SECONDS } from '../physics/fixed-step/FixedTimestepLoop';
import { createRngStreams } from '../rng/SeededRng';
import { SelfTestMatchWorld } from './SelfTestMatchWorld';

/** Speed (m/s) under which a Bey holding MoveForward outside the floor radius counts as wedged (see AiSideStats.longestWedgedTicks). */
const WEDGED_MAX_SPEED_MPS = 0.1;

/** ~100 simulated seconds. Rounds end only by KO/ring-out today (RoundEnd rules are out of M7 scope), so a round can legitimately run this long. */
export const DEFAULT_AI_MATCH_MAX_TICKS = 6000;

export interface AiSideStats {
  personalityId: string;
  /** Ticks spent with each intent active. */
  intentTicks: Record<AiIntent, number>;
  circularAttacks: number;
  dashAttacks: number;
  /** Attacks started (Circular/Dash going active) while the opponent was open: in an attack's Recovery (a whiff) or Broken. */
  punishAttacks: number;
  /** Circular hits that caught the opponent's active Dash (the counter that launches the dasher) — the other way Defense punishes commitment. */
  counterHits: number;
  /** Mean horizontal distance (m) from the arena center, outside an Active Clash. */
  meanRadiusM: number;
  /** Owner audit G2 (2026-10-03): mean horizontal speed (m/s) outside Clash, and at the start of each Circular. */
  meanSpeedMps: number;
  meanCircularStartSpeedMps: number;
  dodges: number;
  jumps: number;
  hitsLanded: number;
  /** Incoming hits this side nullified with dodge i-frames. */
  hitsDodged: number;
  deliberateErrors: number;
  /** Ticks with no button held at all (not moving, not attacking), outside an Active Clash (whose mash-only input is not passivity). */
  idleTicks: number;
  /** Longest run of consecutive idle ticks. */
  longestIdleStreakTicks: number;
  /** Longest run of ticks with an attack intent active, the opponent within Dash range, Attack Energy available, own attack Neutral and Attack NOT held — an AI that wants to attack but never presses (the stale-Dash-charge bug looked exactly like this). */
  longestStalledAttackTicks: number;
  /** Most Attack/Dodge/JumpDrift presses inside any 1-second window, outside an Active Clash (Clash mashing is supposed to be fast). */
  maxPressesPerSecond: number;
  /** Ticks whose position was inside the edge-risk margin (edge risk > 0.5). */
  nearEdgeTicks: number;
  finalStaminaFraction: number;
  /**
   * Longest run of ticks this Bey sat outside the arena floor's radius,
   * barely moving, while its controller held a throttle (forward or reverse) — the physical
   * "wedged against the wall collider" state (GDD section 67 "stuck inside
   * wall"). Reported separately because no controller input can clear it:
   * it is a collision problem, not an AI decision.
   */
  longestWedgedTicks: number;
}

export interface AiMatchStats {
  seed: string;
  ticks: number;
  outcome: RoundOutcome;
  clashes: number;
  clashActiveTicks: number;
  /** Longest run of ticks where NEITHER side held any button outside an Active Clash — a real stalemate, unlike one side waiting while the other acts. */
  longestMutualIdleTicks: number;
  meanDistanceM: number;
  first: AiSideStats;
  second: AiSideStats;
}

export interface AiMatchSetup {
  seed: string;
  /** Omit for the live game's spawns. */
  firstSpawn?: SpawnPositionM;
  secondSpawn?: SpawnPositionM;
  firstDefinition: BeyDefinition;
  secondDefinition: BeyDefinition;
  /** Defaults to the archetype's own personality (as main.ts resolves it). */
  firstPersonality?: AiPersonality;
  secondPersonality?: AiPersonality;
  /** Both sides' difficulty; firstDifficulty/secondDifficulty override it per side. */
  difficulty?: AiDifficultyProfile;
  firstDifficulty?: AiDifficultyProfile;
  secondDifficulty?: AiDifficultyProfile;
  maxTicks?: number;
  /** Match rules (M10: arena wall height/bounce, Clash impact). Omit for the defaults. A recording captures them. */
  matchConfigOverrides?: Partial<MatchConfig>;
  /** M9: record this match as a ChaosBeyReplayV1 (returned in AiMatchRecord.replay). */
  record?: Omit<HeadlessCaptureInput, 'seedText' | 'spawns'>;
  /** Called every tick after the match advanced — for extra invariant checks. */
  onTick?: (tick: number, world: SelfTestMatchWorld, firstActions: ControllerActions, secondActions: ControllerActions, firstAi: AIController, secondAi: AIController) => void;
}

function emptyIntentTicks(): Record<AiIntent, number> {
  const ticks = {} as Record<AiIntent, number>;
  for (const intent of Object.values(AiIntent)) ticks[intent] = 0;
  return ticks;
}

class SideTracker {
  readonly stats: AiSideStats;
  private idleStreak = 0;
  private readonly pressTicks: number[] = [];
  private previousAttackState = AttackState.Neutral;
  private previousDodgeState = DodgeState.Idle;
  private lastDecisionReason = '';
  private stalledAttackStreak = 0;
  private wedgedStreak = 0;
  private radiusSum = 0;
  private speedSum = 0;
  private circularSpeedSum = 0;
  private previousSpeedMps = 0;
  private radiusSamples = 0;

  constructor(personalityId: string) {
    this.stats = {
      personalityId,
      intentTicks: emptyIntentTicks(),
      circularAttacks: 0,
      dashAttacks: 0,
      punishAttacks: 0,
      counterHits: 0,
      meanRadiusM: 0,
      meanSpeedMps: 0,
      meanCircularStartSpeedMps: 0,
      dodges: 0,
      jumps: 0,
      hitsLanded: 0,
      hitsDodged: 0,
      deliberateErrors: 0,
      idleTicks: 0,
      longestIdleStreakTicks: 0,
      maxPressesPerSecond: 0,
      longestStalledAttackTicks: 0,
      longestWedgedTicks: 0,
      nearEdgeTicks: 0,
      finalStaminaFraction: 1,
    };
  }

  record(
    tick: number,
    ai: AIController,
    actions: ControllerActions,
    attackState: AttackState,
    dodgeState: DodgeState,
    clashActive: boolean,
    radiusM: number,
    opponentOpen: boolean,
    dashReadiness: number,
    speedMps: number,
  ): void {
    const throttling = actions.held.has(Action.MoveForward) || actions.held.has(Action.MoveBackward);
    const wedged = !clashActive && radiusM > ARENA_FLOOR_RADIUS && speedMps < WEDGED_MAX_SPEED_MPS && throttling;
    this.wedgedStreak = wedged ? this.wedgedStreak + 1 : 0;
    this.stats.longestWedgedTicks = Math.max(this.stats.longestWedgedTicks, this.wedgedStreak);

    const debug = ai.getDebugState();
    this.stats.intentTicks[debug.activeIntent]++;
    if (debug.deliberateErrorApplied && debug.activeIntentReason !== this.lastDecisionReason) this.stats.deliberateErrors++;
    this.lastDecisionReason = debug.activeIntentReason;
    if (debug.edgeRiskFraction > 0.5) this.stats.nearEdgeTicks++;

    // PressAdvantage is left out on purpose: against an opponent near the
    // edge it first flanks to the center side before swinging (M7 Part 2a).
    const attackIntent = debug.activeIntent === AiIntent.AttackCircular || debug.activeIntent === AiIntent.AttackDash;
    const stalled =
      !clashActive &&
      attackIntent &&
      attackState === AttackState.Neutral &&
      dashReadiness >= 1 &&
      debug.distanceToOpponentM <= AI_DASH_ATTACK_MAX_RANGE_M &&
      !actions.held.has(Action.Attack);
    this.stalledAttackStreak = stalled ? this.stalledAttackStreak + 1 : 0;
    this.stats.longestStalledAttackTicks = Math.max(this.stats.longestStalledAttackTicks, this.stalledAttackStreak);

    if (clashActive) {
      this.idleStreak = 0;
    } else if (actions.held.size === 0) {
      this.stats.idleTicks++;
      this.idleStreak++;
      this.stats.longestIdleStreakTicks = Math.max(this.stats.longestIdleStreakTicks, this.idleStreak);
    } else {
      this.idleStreak = 0;
    }

    if (!clashActive) {
      for (const action of [Action.Attack, Action.Dodge, Action.JumpDrift]) {
        if (actions.pressedThisFrame.has(action)) this.pressTicks.push(tick);
      }
      if (actions.pressedThisFrame.has(Action.JumpDrift)) this.stats.jumps++;
      this.radiusSum += radiusM;
      this.radiusSamples++;
      this.stats.meanRadiusM = this.radiusSum / this.radiusSamples;
      this.speedSum += speedMps;
      this.stats.meanSpeedMps = this.speedSum / this.radiusSamples;
    }
    const windowTicks = Math.round(1 / FIXED_DELTA_SECONDS);
    while (this.pressTicks.length > 0 && this.pressTicks[0]! <= tick - windowTicks) this.pressTicks.shift();
    this.stats.maxPressesPerSecond = Math.max(this.stats.maxPressesPerSecond, this.pressTicks.length);

    const startedCircular = attackState === AttackState.CircularActive && this.previousAttackState !== AttackState.CircularActive;
    const startedDash = attackState === AttackState.DashActive && this.previousAttackState !== AttackState.DashActive;
    if (startedCircular) {
      this.stats.circularAttacks++;
      this.circularSpeedSum += this.previousSpeedMps; // the speed it was moving at when it chose to tap
      this.stats.meanCircularStartSpeedMps = this.circularSpeedSum / this.stats.circularAttacks;
    }
    this.previousSpeedMps = speedMps;
    if (startedDash) this.stats.dashAttacks++;
    if ((startedCircular || startedDash) && opponentOpen) this.stats.punishAttacks++;
    if (dodgeState === DodgeState.Dodging && this.previousDodgeState !== DodgeState.Dodging) this.stats.dodges++;
    this.previousAttackState = attackState;
    this.previousDodgeState = dodgeState;
  }
}

/** One physics anomaly seen during a match (physicsSafety.ts's checks, plus non-finite positions). */
export interface MatchAnomaly extends PhysicsAnomaly {
  readonly tick: number;
  readonly side: 'first' | 'second';
}

/** Anomalies kept per match, so a broken match can't grow the report without bound; `anomalyCount` still counts all of them. */
const MAX_STORED_ANOMALIES = 20;

export interface AiMatchTiming {
  /** Milliseconds spent simulating the match (the sum of its tick times). */
  readonly wallMs: number;
  readonly meanTickMs: number;
  readonly maxTickMs: number;
  /** Ticks slower than `slowTickThresholdMs`. */
  readonly slowTicks: number;
}

/** GDD 67 detections beyond the physics-safety checks, one per episode (see MatchAnomalyDetector). */
export const MAX_STORED_DETECTIONS = 20;

export interface AiMatchRecord {
  readonly stats: AiMatchStats;
  /** The first MAX_STORED_ANOMALIES anomalies, in order. */
  readonly anomalies: readonly MatchAnomaly[];
  readonly anomalyCount: number;
  /** GDD 67 detector findings (first MAX_STORED_DETECTIONS), in order. */
  readonly detections: readonly DetectedAnomaly[];
  /** Detector findings that make the match an invalid state. */
  readonly invalidDetectionCount: number;
  /** Detector findings that are only warnings (e.g. ai-inactive). */
  readonly warningCount: number;
  readonly timing: AiMatchTiming;
  /** Present when the setup asked to record (M9). */
  readonly replay?: ChaosBeyReplayV1;
}

/** One frame at 60 fps: a tick slower than this can't keep a real-time match fed. Diagnostic only. */
export const DEFAULT_SLOW_TICK_THRESHOLD_MS = 1000 / 60;

function checkSide(tick: number, side: 'first' | 'second', world: SelfTestMatchWorld, angular: { x: number; y: number; z: number }, into: MatchAnomaly[]): number {
  const bey = side === 'first' ? world.first : world.second;
  const position = bey.body.translation();
  const linear = bey.body.linvel();
  const found: PhysicsAnomaly[] = [];
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
    found.push({ kind: 'non-finite-value', detail: `position (${position.x}, ${position.y}, ${position.z}) contains a non-finite component` });
  }
  const linearAnomaly = checkLinearVelocity(linear.x, linear.y, linear.z);
  if (linearAnomaly) found.push(linearAnomaly);
  const angularAnomaly = checkAngularVelocity(angular.x, angular.y, angular.z);
  if (angularAnomaly) found.push(angularAnomaly);
  for (const anomaly of found) {
    if (into.length < MAX_STORED_ANOMALIES) into.push({ ...anomaly, tick, side });
  }
  return found.length;
}

/**
 * Simulates one AI-vs-AI round to its end (or `maxTicks`), as fast as the
 * CPU allows: headless, no rendering, the same fixed delta every tick (GDD
 * 164). Throws whatever the simulation throws; the batch runner records
 * that as a crash. The world is always freed afterwards.
 */
export async function simulateAiMatch(setup: AiMatchSetup & { slowTickThresholdMs?: number }): Promise<AiMatchRecord> {
  const world = await SelfTestMatchWorld.build({
    firstSpawn: setup.firstSpawn,
    secondSpawn: setup.secondSpawn,
    aiMashSource: new NullAiMashSource(),
    firstDefinition: setup.firstDefinition,
    secondDefinition: setup.secondDefinition,
    matchConfigOverrides: setup.matchConfigOverrides,
  });
  try {
    return runOnWorld(world, setup, setup.slowTickThresholdMs ?? DEFAULT_SLOW_TICK_THRESHOLD_MS);
  } finally {
    world.dispose();
  }
}

function runOnWorld(world: SelfTestMatchWorld, setup: AiMatchSetup, slowTickThresholdMs: number): AiMatchRecord {
  const steps = stepAiMatchOnWorld(world, setup, slowTickThresholdMs);
  for (let next = steps.next(); ; next = steps.next()) {
    if (next.done) return next.value;
  }
}

/**
 * The match loop, one fixed tick per iteration: yields the tick index just
 * simulated and returns the record when the round ends (or at maxTicks).
 * simulateAiMatch() drains it in one go; the browser Self Test steps it a
 * few ticks per frame (GDD 164: more fixed ticks per second, never a bigger
 * delta) so the page stays responsive. Same loop either way.
 */
export function* stepAiMatchOnWorld(world: SelfTestMatchWorld, setup: AiMatchSetup, slowTickThresholdMs: number = DEFAULT_SLOW_TICK_THRESHOLD_MS): Generator<number, AiMatchRecord, void> {
  const difficulty = setup.difficulty ?? DEFAULT_AI_DIFFICULTY_PROFILE;
  const firstDifficulty = setup.firstDifficulty ?? difficulty;
  const secondDifficulty = setup.secondDifficulty ?? difficulty;
  const firstPersonality = setup.firstPersonality ?? personalityForBeyDefinitionId(setup.firstDefinition.id);
  const secondPersonality = setup.secondPersonality ?? personalityForBeyDefinitionId(setup.secondDefinition.id);
  // RNG scheme 2 (M9): the same per-side streams a live match with this seed uses.
  const rng = createRngStreams(setup.seed);
  const firstAi = new AIController(
    world.physics,
    world.first,
    world.second,
    world.clash.controller,
    firstPersonality,
    firstDifficulty,
    rng.aiFirst,
  );
  const secondAi = new AIController(
    world.physics,
    world.second,
    world.first,
    world.clash.controller,
    secondPersonality,
    secondDifficulty,
    rng.aiSecond,
  );

  // Before the first tick: the initial state is the replay's first checkpoint.
  const capture = setup.record
    ? startHeadlessCapture(world, { matchConfig: resolveMatchConfig(setup.matchConfigOverrides ?? {}), ...setup.record, seedText: setup.seed, spawns: { first: setup.firstSpawn ?? matchSpawnsFor(resolveMatchConfig(setup.matchConfigOverrides ?? {}).arenaFloor).first, second: setup.secondSpawn ?? matchSpawnsFor(resolveMatchConfig(setup.matchConfigOverrides ?? {}).arenaFloor).second } })
    : null;

  const first = new SideTracker(firstPersonality.id);
  const second = new SideTracker(secondPersonality.id);
  const maxTicks = setup.maxTicks ?? DEFAULT_AI_MATCH_MAX_TICKS;
  const anomalies: MatchAnomaly[] = [];
  let anomalyCount = 0;
  const resolvedArena = resolveMatchConfig(setup.matchConfigOverrides ?? {});
  const detector = new MatchAnomalyDetector({ ...DEFAULT_ANOMALY_THRESHOLDS, wallHeightM: floorRimHeight(arenaFloorOf(resolvedArena)) + resolvedArena.arenaWallHeightM });
  const detections: DetectedAnomaly[] = [];
  let invalidDetectionCount = 0;
  let warningCount = 0;
  let clashes = 0;
  let clashActiveTicks = 0;
  let mutualIdleStreak = 0;
  let longestMutualIdleTicks = 0;
  // The opponent's state on the tick BEFORE an attack went active — the
  // state the attacker was reacting to when it committed.
  let previousFirstAttackState = AttackState.Neutral;
  let previousSecondAttackState = AttackState.Neutral;
  let previousFirstBroken = false;
  let previousSecondBroken = false;
  let distanceSum = 0;
  let ticks = 0;
  let maxTickMs = 0;
  let slowTicks = 0;
  // Time spent simulating (sum of tick times), not wall time between the
  // first and last tick: a stepped run pauses between frames.
  let busyMs = 0;

  for (let tick = 0; tick < maxTicks; tick++) {
    const tickStartMs = performance.now();
    // The same per-tick step as a live match, hitstop included (M9). On a
    // hitstop-frozen tick the result is the previous tick's: its events
    // were already counted.
    const { firstActions, secondActions, result, advanced } = world.step({ first: firstAi, second: secondAi });
    capture?.afterTick(tick, firstActions, secondActions);
    ticks = tick + 1;

    const clashActive = world.clash.controller.getState() === ClashState.Active;
    if (clashActive) clashActiveTicks++;
    const a = world.first.body.translation();
    const b = world.second.body.translation();
    const isOpen = (attackState: AttackState, broken: boolean) =>
      broken || attackState === AttackState.DashRecovery || attackState === AttackState.CircularRecovery;
    first.record(tick, firstAi, firstActions, result.first.attackState, result.first.dodgeState, clashActive, Math.hypot(a.x, a.z), isOpen(previousSecondAttackState, previousSecondBroken), result.first.dashReadiness, result.first.movement.speedMps);
    second.record(tick, secondAi, secondActions, result.second.attackState, result.second.dodgeState, clashActive, Math.hypot(b.x, b.z), isOpen(previousFirstAttackState, previousFirstBroken), result.second.dashReadiness, result.second.movement.speedMps);
    previousFirstAttackState = result.first.attackState;
    previousSecondAttackState = result.second.attackState;
    previousFirstBroken = result.first.isBroken;
    previousSecondBroken = result.second.isBroken;
    if (advanced) {
      for (const hit of result.hitEvents) {
        const attacker = hit.attackerIsFirst ? first : second;
        attacker.stats.hitsLanded++;
        if (hit.caughtOpponentDashing) attacker.stats.counterHits++;
      }
      for (const event of result.combatEvents) {
        if (event.kind === 'dodged') (event.targetIsFirst ? first : second).stats.hitsDodged++;
      }
      if (result.clashResolvedThisTick) clashes++;
    }
    mutualIdleStreak = !clashActive && firstActions.held.size === 0 && secondActions.held.size === 0 ? mutualIdleStreak + 1 : 0;
    longestMutualIdleTicks = Math.max(longestMutualIdleTicks, mutualIdleStreak);
    distanceSum += Math.hypot(a.x - b.x, a.z - b.z);
    first.stats.finalStaminaFraction = result.first.staminaFraction;
    second.stats.finalStaminaFraction = result.second.staminaFraction;

    anomalyCount += checkSide(tick, 'first', world, result.first.spin.angularVelocity, anomalies);
    anomalyCount += checkSide(tick, 'second', world, result.second.spin.angularVelocity, anomalies);
    for (const detection of detector.check({
      tick,
      first: world.first,
      second: world.second,
      result,
      roundState: world.roundState,
      clash: world.clash.controller,
      firstActions,
      secondActions,
      aiSides: { first: true, second: true },
      hitstopActive: !advanced,
    })) {
      if (detection.severity === 'invalid-state') invalidDetectionCount++;
      else warningCount++;
      if (detections.length < MAX_STORED_DETECTIONS) detections.push(detection);
    }

    setup.onTick?.(tick, world, firstActions, secondActions, firstAi, secondAi);

    const tickMs = performance.now() - tickStartMs;
    busyMs += tickMs;
    maxTickMs = Math.max(maxTickMs, tickMs);
    if (tickMs > slowTickThresholdMs) slowTicks++;
    if (world.roundState.isOver) break;
    yield tick;
  }

  const wallMs = busyMs;
  return {
    stats: {
      seed: setup.seed,
      ticks,
      outcome: world.roundState.result,
      clashes,
      clashActiveTicks,
      longestMutualIdleTicks,
      meanDistanceM: distanceSum / Math.max(1, ticks),
      first: first.stats,
      second: second.stats,
    },
    anomalies,
    anomalyCount,
    detections,
    invalidDetectionCount,
    warningCount,
    timing: { wallMs, meanTickMs: wallMs / Math.max(1, ticks), maxTickMs, slowTicks },
    ...(capture ? { replay: capture.finish() } : {}),
  };
}

/** Fraction of `stats`' active ticks spent in any of `intents`. */
export function intentShare(stats: AiSideStats, intents: readonly AiIntent[]): number {
  const total = Object.values(stats.intentTicks).reduce((sum, n) => sum + n, 0);
  if (total === 0) return 0;
  return intents.reduce((sum, intent) => sum + stats.intentTicks[intent], 0) / total;
}
