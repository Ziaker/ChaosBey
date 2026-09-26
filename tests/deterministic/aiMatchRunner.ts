// ============================================================
// AI VS AI MATCH RUNNER — HEADLESS SELF-TEST HELPER (MILESTONE 7)
// GDD section 66/67/162/163: AI vs AI is required for balancing, long-run
// stability and regression detection. Runs one full round between two real
// AIControllers through the same tickMatch() orchestration production uses
// (CombatHarness), and collects a per-side behavior summary — what each AI
// actually chose and pressed, and what that produced — so tests can assert
// on observable archetype differences, passivity and spam instead of on
// internal scores alone.
// ============================================================

import { AIController } from '../../src/ai/controllers/AIController';
import { AI_DASH_ATTACK_MAX_RANGE_M } from '../../src/ai/decision/AiCombatRanges';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE, type AiDifficultyProfile } from '../../src/ai/difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../../src/ai/personalities/AiPersonality';
import { personalityForBeyDefinitionId } from '../../src/ai/personalities/AiArchetypePersonalities';
import type { BeyDefinition } from '../../src/bey/archetype/BeyDefinition';
import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { DodgeState } from '../../src/dodge/DodgeController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

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
  /** Mean horizontal distance (m) from the arena center, outside an Active Clash. */
  meanRadiusM: number;
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
   * barely moving, while its controller held MoveForward — the physical
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
  firstDefinition: BeyDefinition;
  secondDefinition: BeyDefinition;
  /** Defaults to the archetype's own personality (as main.ts resolves it). */
  firstPersonality?: AiPersonality;
  secondPersonality?: AiPersonality;
  difficulty?: AiDifficultyProfile;
  maxTicks?: number;
  /** Called every tick after the match advanced — for extra invariant checks. */
  onTick?: (tick: number, harness: CombatHarness, firstActions: ControllerActions, secondActions: ControllerActions, firstAi: AIController, secondAi: AIController) => void;
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
  private radiusSamples = 0;

  constructor(personalityId: string) {
    this.stats = {
      personalityId,
      intentTicks: emptyIntentTicks(),
      circularAttacks: 0,
      dashAttacks: 0,
      punishAttacks: 0,
      meanRadiusM: 0,
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
    attackEnergyFraction: number,
    speedMps: number,
  ): void {
    const wedged = !clashActive && radiusM > ARENA_FLOOR_RADIUS && speedMps < WEDGED_MAX_SPEED_MPS && actions.held.has(Action.MoveForward);
    this.wedgedStreak = wedged ? this.wedgedStreak + 1 : 0;
    this.stats.longestWedgedTicks = Math.max(this.stats.longestWedgedTicks, this.wedgedStreak);

    const debug = ai.getDebugState();
    this.stats.intentTicks[debug.activeIntent]++;
    if (debug.deliberateErrorApplied && debug.activeIntentReason !== this.lastDecisionReason) this.stats.deliberateErrors++;
    this.lastDecisionReason = debug.activeIntentReason;
    if (debug.edgeRiskFraction > 0.5) this.stats.nearEdgeTicks++;

    const attackIntent = debug.activeIntent === AiIntent.AttackCircular || debug.activeIntent === AiIntent.AttackDash || debug.activeIntent === AiIntent.PressAdvantage;
    const stalled =
      !clashActive &&
      attackIntent &&
      attackState === AttackState.Neutral &&
      attackEnergyFraction > 0.3 &&
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
    }
    const windowTicks = Math.round(1 / FIXED_DELTA_SECONDS);
    while (this.pressTicks.length > 0 && this.pressTicks[0]! <= tick - windowTicks) this.pressTicks.shift();
    this.stats.maxPressesPerSecond = Math.max(this.stats.maxPressesPerSecond, this.pressTicks.length);

    const startedCircular = attackState === AttackState.CircularActive && this.previousAttackState !== AttackState.CircularActive;
    const startedDash = attackState === AttackState.DashActive && this.previousAttackState !== AttackState.DashActive;
    if (startedCircular) this.stats.circularAttacks++;
    if (startedDash) this.stats.dashAttacks++;
    if ((startedCircular || startedDash) && opponentOpen) this.stats.punishAttacks++;
    if (dodgeState === DodgeState.Dodging && this.previousDodgeState !== DodgeState.Dodging) this.stats.dodges++;
    this.previousAttackState = attackState;
    this.previousDodgeState = dodgeState;
  }
}

export async function runAiMatch(setup: AiMatchSetup): Promise<AiMatchStats> {
  const harness = await CombatHarness.create(undefined, undefined, {}, new NullAiMashSource(), {
    first: setup.firstDefinition,
    second: setup.secondDefinition,
  });
  const difficulty = setup.difficulty ?? DEFAULT_AI_DIFFICULTY_PROFILE;
  const firstPersonality = setup.firstPersonality ?? personalityForBeyDefinitionId(setup.firstDefinition.id);
  const secondPersonality = setup.secondPersonality ?? personalityForBeyDefinitionId(setup.secondDefinition.id);
  const firstAi = new AIController(
    harness.physics,
    harness.first,
    harness.second,
    harness.clash.controller,
    firstPersonality,
    difficulty,
    SeededRng.fromSeedText(`${setup.seed}/first`),
  );
  const secondAi = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    secondPersonality,
    difficulty,
    SeededRng.fromSeedText(`${setup.seed}/second`),
  );

  const first = new SideTracker(firstPersonality.id);
  const second = new SideTracker(secondPersonality.id);
  const maxTicks = setup.maxTicks ?? DEFAULT_AI_MATCH_MAX_TICKS;
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

  for (let tick = 0; tick < maxTicks; tick++) {
    const firstActions = firstAi.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const secondActions = secondAi.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const result = harness.tick(firstActions, secondActions);
    ticks = tick + 1;

    const clashActive = harness.clash.controller.getState() === ClashState.Active;
    if (clashActive) clashActiveTicks++;
    const a = harness.first.body.translation();
    const b = harness.second.body.translation();
    const isOpen = (attackState: AttackState, broken: boolean) =>
      broken || attackState === AttackState.DashRecovery || attackState === AttackState.CircularRecovery;
    first.record(tick, firstAi, firstActions, result.first.attackState, result.first.dodgeState, clashActive, Math.hypot(a.x, a.z), isOpen(previousSecondAttackState, previousSecondBroken), result.first.attackEnergyFraction, result.first.movement.speedMps);
    second.record(tick, secondAi, secondActions, result.second.attackState, result.second.dodgeState, clashActive, Math.hypot(b.x, b.z), isOpen(previousFirstAttackState, previousFirstBroken), result.second.attackEnergyFraction, result.second.movement.speedMps);
    previousFirstAttackState = result.first.attackState;
    previousSecondAttackState = result.second.attackState;
    previousFirstBroken = result.first.isBroken;
    previousSecondBroken = result.second.isBroken;
    for (const hit of result.hitEvents) (hit.attackerIsFirst ? first : second).stats.hitsLanded++;
    for (const event of result.combatEvents) {
      if (event.kind === 'dodged') (event.targetIsFirst ? first : second).stats.hitsDodged++;
    }
    if (result.clashResolvedThisTick) clashes++;
    mutualIdleStreak = !clashActive && firstActions.held.size === 0 && secondActions.held.size === 0 ? mutualIdleStreak + 1 : 0;
    longestMutualIdleTicks = Math.max(longestMutualIdleTicks, mutualIdleStreak);
    distanceSum += Math.hypot(a.x - b.x, a.z - b.z);
    first.stats.finalStaminaFraction = result.first.staminaFraction;
    second.stats.finalStaminaFraction = result.second.staminaFraction;

    setup.onTick?.(tick, harness, firstActions, secondActions, firstAi, secondAi);
    if (harness.roundState.isOver) break;
  }

  return {
    seed: setup.seed,
    ticks,
    outcome: harness.roundState.result,
    clashes,
    clashActiveTicks,
    longestMutualIdleTicks,
    meanDistanceM: distanceSum / Math.max(1, ticks),
    first: first.stats,
    second: second.stats,
  };
}

/** Fraction of `stats`' active ticks spent in any of `intents`. */
export function intentShare(stats: AiSideStats, intents: readonly AiIntent[]): number {
  const total = Object.values(stats.intentTicks).reduce((sum, n) => sum + n, 0);
  if (total === 0) return 0;
  return intents.reduce((sum, intent) => sum + stats.intentTicks[intent], 0) / total;
}
