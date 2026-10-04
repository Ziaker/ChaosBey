// ============================================================
// AI CONTROLLER (MILESTONE 7)
// Implements the same CombatController interface as KeyboardController/
// ScriptedController (GDD section 113) — tickMatch()/main.ts cannot tell
// this apart from a player or a scripted test agent. Wires together every
// M7 layer (GDD section 62: perception -> world state -> risk evaluation ->
// intent -> action selection -> controller output) into one per-tick
// decision.
//
// Owner rule: the AI must obey the same rules as a player. This class
// never touches a RigidBody, never reads anything beyond the same public
// getters a debug overlay/telemetry already use, and produces its output
// exclusively through ControllerActions — the same narrow channel a human
// player's input goes through. It reads its own and its opponent's Bey
// only for perception (position/velocity/heading/state), never to mutate
// them directly.
//
// Reaction delay (GDD section 63): a fresh intent decision — including its
// risk evaluation, deliberate-error roll, and adaptation update — is made
// only once every personality.reactionDelaySeconds (scaled by the active
// AiDifficultyProfile). Between decisions the previous intent keeps being
// acted on, and world/perception are still recomputed every tick so
// ActionSelection always reacts to *current* positions/state, just without
// re-litigating the higher-level "what should I be doing" question every
// single fixed tick (which would look inhumanly twitchy).
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Bey } from '../../bey/core/Bey';
import { AttackState } from '../../combat/attacks/AttackController';
import { ClashState, type ClashController } from '../../combat/clash/ClashController';
import { DODGE_STAMINA_COST } from '../../dodge/DodgeTuning';
import { DriftState } from '../../drift/DriftController';
import { Action, type CombatController, type ControllerActions, type ControllerContext } from '../../input/actions/Action';
import { isGrounded } from '../../physics/collision/GroundCheck';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import type { SeededRng } from '../../rng/SeededRng';
import { TelemetryEventKind } from '../../telemetry/events/TelemetryEvent';
import type { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';
import { applyAdaptationNudge, AdaptationTracker } from '../adaptation/AdaptationTracker';
import { ActionSelector } from '../decision/ActionSelection';
import { AiIntent } from '../decision/Intent';
import { selectIntent, type ConsideredScore, type IntentDecision } from '../decision/IntentSelection';
import { evaluateRisk, type RiskAssessment } from '../decision/RiskEvaluation';
import { buildWorldState, type WorldState } from '../decision/WorldState';
import type { AiDebugState } from '../debug/AiDebugState';
import { applyDifficultyTraits, type AiDifficultyProfile } from '../difficulty/AiDifficultyProfile';
import { isCriticalDecision, maybeApplyIntentionalError } from '../errors/IntentionalError';
import { ENGAGED_ATTACK_STATES, perceiveCombatant, type CombatantRawState } from '../perception/AiPerception';
import type { AiPersonality } from '../personalities/AiPersonality';

/** Baseline EMA smoothing factor applied to AdaptationTracker per decision (see AdaptationTracker.ts) — this AI's adaptationRate/the active difficulty's adaptationMultiplier further scale how much this actually moves anything. */
const ADAPTATION_BASE_ALPHA = 0.15;

/** How far ahead AiDifficultyProfile.predictionStrength extrapolates the opponent's position for targeting/steering (GDD section 59/111) — short enough that a sharp, unpredictable direction change doesn't make the prediction actively misleading. */
const PREDICTION_HORIZON_S = 0.35;

function isAttackIntent(intent: AiIntent): boolean {
  return (
    intent === AiIntent.AttackCircular ||
    intent === AiIntent.AttackDash ||
    intent === AiIntent.PressAdvantage ||
    intent === AiIntent.CounterAttack
  );
}

/** An opponent Dash in progress — from its visible charge through its active lunge. */
const OPPONENT_DASH_STATES: ReadonlySet<AttackState> = new Set([AttackState.ChargingDash, AttackState.DashActive]);

/** How many of the best candidates the one-line overlay summary shows (the debug state and telemetry carry all of them). */
const SCORES_SUMMARY_SHOWN = 4;

function summarizeScores(decision: IntentDecision, shown = SCORES_SUMMARY_SHOWN): string {
  const scores: readonly ConsideredScore[] | undefined = decision.consideredScores;
  if (!scores || scores.length === 0) return 'override (see reason)';
  const head = scores.slice(0, shown).map((entry) => `${entry.intent} ${entry.score.toFixed(2)}`).join(' / ');
  const summary = scores.length > shown ? `${head} (+${scores.length - shown} more)` : head;
  // Only when it actually shaped this decision (see IntentSelection.clashWillingness).
  const willingness = decision.clashWillingness;
  return willingness !== undefined && willingness < 1 ? `${summary} [clash x${willingness.toFixed(2)}]` : summary;
}

function extractRawState(physics: PhysicsWorld, body: RAPIER.RigidBody, bey: Bey): CombatantRawState {
  const translation = body.translation();
  const velocity = body.linvel();
  return {
    positionXZ: { x: translation.x, z: translation.z },
    velocityXZ: { x: velocity.x, z: velocity.z },
    headingRad: bey.movement.getHeadingRad(),
    grounded: isGrounded(physics, bey.collider),
    attackState: bey.attack.getState(),
    dashChargeFraction: bey.attack.getChargeFraction(),
    dodgeState: bey.dodge.getState(),
    driftState: bey.drift.getState(),
    staminaFraction: bey.stamina.resource.fraction,
    stabilityFraction: bey.stability.resource.fraction,
    isBroken: bey.stability.isBroken,
    dashReadiness: bey.attack.getDashReadiness(),
    momentum: bey.momentum.value,
    airRecoveryAvailable: bey.dodge.isAirRecoveryAvailable(),
    // Owner, 2026-10-02 (Lote 5): Stamina 0 is a spin-out loss, so the AI keeps a reserve and never dodges itself into one.
    // A free dodge (owner, 2026-10-04: no Stamina cost) needs no reserve either.
    canAffordDodge: bey.stamina.resource.value >= (bey.rules.dodgeStaminaCost ?? DODGE_STAMINA_COST) + ((bey.rules.dodgeStaminaCost ?? DODGE_STAMINA_COST) > 0 ? AI_DODGE_STAMINA_RESERVE : 0),
  };
}

/**
 * Stamina the AI keeps after a dodge (Lote 5: Stamina 0 = spin-out). PROVISIONAL AI tuning. Owner audit, 2026-10-03:
 * 15 left Ace losing 18 of 72 tier rounds by spin-out (Rookie 2) — it dodged itself empty while winning the fights
 * (31 KOs to 17); at 45, Ace's spin-outs drop to 5 and it wins 45-25, still dodging 1.6× as often as Rookie.
 */
export const AI_DODGE_STAMINA_RESERVE = 45;

const ZERO_RISK: RiskAssessment = { edgeRisk: 0, opponentThreat: 0, selfVulnerability: 0, opportunity: 0, punishWindow: false, edgePressure: 0 };

export class AIController implements CombatController {
  private readonly actionSelector = new ActionSelector();
  /**
   * A separate ActionSelector for the Clash-mash path (sampleClashMashActions)
   * so its held/pressedThisFrame bookkeeping never shares state with
   * actionSelector's normal-combat one. Without this, an Attack the mash
   * happened to hold right up to the Clash's Active -> Cooldown resolution
   * stayed in the shared selector's "already held" bookkeeping, so the very
   * next real AttackCircular/AttackDash decision after the Clash produced no
   * fresh pressedThisFrame press — AttackController.tick() only starts an
   * attack from Neutral on a real press, never from held alone — silently
   * swallowing that attack (M7 audit regression).
   */
  private readonly clashMashActionSelector = new ActionSelector();
  private readonly adaptation = new AdaptationTracker();
  private nowS = 0;
  /** Forces an immediate first decision on the very first non-frozen tick. */
  private decisionTimerS = Number.POSITIVE_INFINITY;
  private idealDecision: IntentDecision = { intent: AiIntent.Circle, reason: 'boot' };
  private activeDecision: IntentDecision = { intent: AiIntent.Circle, reason: 'boot' };
  private deliberateErrorApplied = false;
  private lastRisk: RiskAssessment = ZERO_RISK;
  private lastWorld: WorldState | null = null;
  private lastActionSummary = 'none yet';
  /** Rolled exactly once per fresh DodgeThreat decision (see makeFreshDecision) — ActionSelection reads this instead of rolling AiPersonality.dodgeSkill itself every fixed tick, which would otherwise let a moderate skill converge toward near-certain success over a multi-tick threat window. */
  private dodgeAttemptSucceeds = false;
  /** AiPersonality.counterAffinity rolled once per opponent Dash (ChargingDash through DashActive); null while the opponent isn't dashing. Same once-per-event reasoning as dodgeAttemptSucceeds. */
  private counterRollForOpponentDash: boolean | null = null;
  /** Simulated time this AI last started an attack (own attackState left Neutral) — feeds the anti-passivity tempo (see IntentSelection.passivityTempo). */
  private lastOwnAttackStartS = 0;
  private lastOwnAttackState: AttackState = AttackState.Neutral;
  /**
   * "Slow to react" deliberate error (IntentionalError.ts): a fresh
   * decision already made but not yet acted on. Until pendingDelayRemainingS
   * of simulated time has passed, the AI keeps acting on its PREVIOUS
   * activeDecision — the reaction itself is late, not the decision after
   * it. No new fresh decision replaces it meanwhile (a normal reaction
   * cycle would otherwise silently replace the late decision, turning a
   * late reaction into a skipped one) — except a critical one: the
   * situation is still re-read at the reaction cadence, and air recovery
   * or a critical edge recovery takes over at once (see
   * preemptPendingIfCritical). A launch also clears it.
   */
  private pendingDecision: IntentDecision | null = null;
  private pendingDelayRemainingS = 0;
  private pendingDodgeAttemptSucceeds = false;
  /** True from the first tick this Bey is seen airborne with an air-recovery window (just launched) until that window closes — see sampleActions. */
  private reactingToLaunch = false;
  /** Tracks ClashState.Active across ticks so the Idle/Cooldown -> Active edge can be detected — see sampleActions's clashMashActionSelector.reset() call. */
  private wasClashActive = false;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly ownBey: Bey,
    private readonly opponentBey: Bey,
    private readonly clashController: ClashController,
    personality: AiPersonality,
    private readonly difficulty: AiDifficultyProfile,
    private readonly rng: SeededRng,
    private readonly telemetry: TelemetryRecorder | null = null,
  ) {
    this.personality = applyDifficultyTraits(personality, difficulty);
  }

  /** The archetype personality with the difficulty's evasion and arena awareness applied. */
  private readonly personality: AiPersonality;

  sampleActions(context: ControllerContext): ControllerActions {
    if (context.simulationFrozen) {
      return this.actionSelector.repeatFrozenActions(context.fixedDeltaSeconds);
    }

    const clashActive = this.clashController.getState() === ClashState.Active;
    if (clashActive) {
      // A fresh Clash: the dedicated selector must not carry an "already
      // held" action over from whatever the previous Clash's last mash
      // tick held (see ActionSelector.reset()'s own doc comment) — nothing
      // else ever calls commit() on this selector between Clashes to
      // clear it on its own.
      if (!this.wasClashActive) this.clashMashActionSelector.reset();
      this.wasClashActive = true;
      return this.sampleClashMashActions(context.fixedDeltaSeconds);
    }
    this.wasClashActive = false;

    this.nowS += context.fixedDeltaSeconds;

    const ownRaw = extractRawState(this.physics, this.ownBey.body, this.ownBey);
    const opponentRaw = extractRawState(this.physics, this.opponentBey.body, this.opponentBey);
    const ownPerceived = perceiveCombatant(ownRaw);
    const opponentPerceived = perceiveCombatant(opponentRaw);
    const world = buildWorldState(
      this.nowS,
      ownPerceived,
      opponentPerceived,
      { state: this.clashController.getState(), cooldownRemainingS: this.clashController.getCooldownRemainingS() },
      { horizonSeconds: PREDICTION_HORIZON_S, strength: this.difficulty.predictionStrength },
      { circularReachM: this.ownCircularReachM() },
    );
    this.lastWorld = world;

    if (this.lastOwnAttackState === AttackState.Neutral && ownRaw.attackState !== AttackState.Neutral) {
      this.lastOwnAttackStartS = this.nowS;
    }
    this.lastOwnAttackState = ownRaw.attackState;

    if (OPPONENT_DASH_STATES.has(opponentRaw.attackState)) {
      if (this.counterRollForOpponentDash === null) {
        this.counterRollForOpponentDash = this.rng.nextBool(this.personality.counterAffinity);
      }
    } else {
      this.counterRollForOpponentDash = null;
    }

    // A commitment already in flight — this AI's own attack mid-swing, or
    // its own jump/drift mid-hop — must survive reaction-delay-gated
    // re-decisions rather than being silently abandoned the instant a new
    // decision would otherwise fire. Without this, AttackDash's charge (or
    // UseJumpDrift's hop-into-drift) could be cut short by an unrelated
    // re-decision well before its own intentional release/landing point —
    // ActionSelection only keeps holding Attack/JumpDrift while the
    // matching intent is still active. Re-decision resumes the instant the
    // real system itself reports the commitment over (attack back to
    // Neutral/Recovery, drift back to Idle/Recovering).
    const committedToAttack = ENGAGED_ATTACK_STATES.has(ownRaw.attackState) && isAttackIntent(this.activeDecision.intent);
    const committedToDrift =
      (ownRaw.driftState === DriftState.Hopping || ownRaw.driftState === DriftState.Drifting) && this.activeDecision.intent === AiIntent.UseJumpDrift;
    // Holding ground for a Circular counter must survive re-decisions while
    // the opponent's Dash is still coming, or the stance would be dropped
    // right before the moment it exists for.
    const committedToCounter =
      this.activeDecision.intent === AiIntent.CounterAttack &&
      ownRaw.attackState === AttackState.Neutral &&
      OPPONENT_DASH_STATES.has(opponentRaw.attackState);
    // Being launched (GDD section 21) is a new situation that overrides any
    // commitment still in flight — an AI knocked airborne mid-Dash-charge
    // otherwise kept charging in the air and never recovered. The reaction
    // still takes a full reaction delay, counted from the launch itself
    // (not from the last decision, which could make it instant).
    const launched = !ownRaw.grounded && ownRaw.airRecoveryAvailable;
    if (launched && !this.reactingToLaunch) {
      // A late reaction to the pre-launch situation is moot now.
      this.reactingToLaunch = true;
      this.pendingDecision = null;
      this.decisionTimerS = 0;
    } else if (!launched) {
      this.reactingToLaunch = false;
    }
    const committed = !launched && (committedToAttack || committedToDrift || committedToCounter);

    const effectiveReactionDelayS = Math.max(0, this.personality.reactionDelaySeconds * this.difficulty.reactionDelayMultiplier);
    if (this.pendingDecision) {
      // A late reaction: count down on simulated time only, and never swap
      // intent under an in-flight commitment of the previous one — the same
      // rule fresh decisions follow.
      this.pendingDelayRemainingS -= context.fixedDeltaSeconds;
      this.decisionTimerS += context.fixedDeltaSeconds;
      if (!committed && this.pendingDelayRemainingS <= 0) {
        this.activatePendingDecision();
      } else if (!committed && this.decisionTimerS >= effectiveReactionDelayS) {
        // The situation is still re-read at the normal reaction cadence;
        // only a critical decision (see isCriticalDecision) takes over from
        // the late one — anything else leaves it pending, untouched.
        this.decisionTimerS = 0;
        this.preemptPendingIfCritical(world);
      }
    } else {
      this.decisionTimerS += context.fixedDeltaSeconds;
      if (!committed && this.decisionTimerS >= effectiveReactionDelayS) {
        this.decisionTimerS = 0;
        this.makeFreshDecision(world);
      }
    }

    const actions = this.actionSelector.selectActions(this.activeDecision.intent, world, this.personality, this.dodgeAttemptSucceeds, context.fixedDeltaSeconds);
    this.lastActionSummary = summarizeActions(actions);
    return actions;
  }

  private makeFreshDecision(world: WorldState): void {
    this.adaptation.update(world.opponent, ADAPTATION_BASE_ALPHA * this.clampedAdaptationRate());
    const { adjustedPersonality, risk, ideal } = this.evaluateIdeal(world);
    this.adoptDecision(ideal, risk, adjustedPersonality);
  }

  /**
   * A late ("slow to react") decision is pending: re-read the situation and,
   * only if what it calls for now is critical (air recovery, critical edge
   * recovery or edge-safe evasion — the same decisions no deliberate error
   * may touch), drop the late decision and act on the critical one. A
   * non-critical read changes nothing (no adaptation update, no RNG, no
   * telemetry): the late reaction still lands as it was decided.
   */
  private preemptPendingIfCritical(world: WorldState): void {
    const { adjustedPersonality, risk, ideal } = this.evaluateIdeal(world);
    if (!isCriticalDecision(ideal, risk)) return;
    this.pendingDecision = null;
    this.pendingDelayRemainingS = 0;
    this.adoptDecision(ideal, risk, adjustedPersonality);
  }

  private evaluateIdeal(world: WorldState): { adjustedPersonality: AiPersonality; risk: RiskAssessment; ideal: IntentDecision } {
    const adjustedPersonality = applyAdaptationNudge(this.personality, this.adaptation.getSnapshot(), this.clampedAdaptationRate());
    const risk = evaluateRisk(world, adjustedPersonality);
    const ideal = selectIntent(world, adjustedPersonality, risk, {
      counterDash: this.counterRollForOpponentDash === true,
      secondsSinceOwnAttack: world.nowS - this.lastOwnAttackStartS,
      // From the IDEAL decision: a deliberate hesitation must not make the
      // AI forget it was mid-recovery (the lower release threshold would
      // otherwise be lost and recovery restarted from the entry threshold).
      recoveringFromEdge: this.idealDecision.edgeRecovery === true,
    });
    return { adjustedPersonality, risk, ideal };
  }

  private adoptDecision(ideal: IntentDecision, risk: RiskAssessment, adjustedPersonality: AiPersonality): void {
    this.lastRisk = risk;
    this.idealDecision = ideal;

    const { decision, errorApplied, extraDelaySeconds } = maybeApplyIntentionalError(ideal, risk, adjustedPersonality, this.difficulty, this.rng);
    this.deliberateErrorApplied = errorApplied;

    // Rolled exactly once for this fresh decision (see the field's own doc
    // comment) — a no-op (stays false) for every other intent.
    const dodgeAttemptSucceeds = decision.intent === AiIntent.DodgeThreat ? this.rng.nextBool(adjustedPersonality.dodgeSkill) : false;

    if (extraDelaySeconds > 0) {
      this.pendingDecision = decision;
      this.pendingDelayRemainingS = extraDelaySeconds;
      this.pendingDodgeAttemptSucceeds = dodgeAttemptSucceeds;
    } else {
      this.activeDecision = decision;
      this.dodgeAttemptSucceeds = dodgeAttemptSucceeds;
    }

    if (this.telemetry) {
      this.telemetry.record({
        kind: TelemetryEventKind.AiDecision,
        personalityId: this.personality.id,
        intent: decision.intent,
        reason: decision.reason,
        deliberateErrorApplied: errorApplied,
        edgeRiskFraction: risk.edgeRisk,
        opponentThreatFraction: risk.opponentThreat,
        extraReactionDelayS: extraDelaySeconds,
        consideredScores: summarizeScores(ideal, Number.POSITIVE_INFINITY),
      });
    }
  }

  private activatePendingDecision(): void {
    if (!this.pendingDecision) return;
    this.activeDecision = this.pendingDecision;
    this.dodgeAttemptSucceeds = this.pendingDodgeAttemptSucceeds;
    this.pendingDecision = null;
    this.pendingDelayRemainingS = 0;
    // The reaction cycle restarts from the moment the late reaction lands.
    this.decisionTimerS = 0;
  }

  /** This AI's own Circular reach, the same sum HitDetection uses (own hitbox radius + both bodies' averaged radii) — its own Bey's attack profile and the opponent's visible size, nothing hidden. */
  private ownCircularReachM(): number {
    return (
      this.ownBey.definition.attack.circularHitboxRadiusM +
      (this.ownBey.definition.physical.colliderRadiusM + this.opponentBey.definition.physical.colliderRadiusM) / 2
    );
  }

  private clampedAdaptationRate(): number {
    return Math.max(0, Math.min(1, this.personality.adaptationRate * this.difficulty.adaptationMultiplier));
  }

  /**
   * During an Active Clash, tickMatch() freezes normal simulation entirely
   * (GDD section 39/152) — position/velocity/attack state don't change, so
   * the full perception/intent pipeline has nothing meaningful to react to.
   * The only decision left is mashing Z/X/C through the same
   * ControllerActions channel a player's real presses use (GDD section 42:
   * "The AI should not literally need to synthesize browser keyboard
   * events. Its controller can produce the same abstract Clash input
   * action as a player controller"). Each tick independently rolls whether
   * a mash event happens (probability = personality's per-second rate
   * scaled by this tick's duration and the difficulty's multiplier), and
   * if so picks one of the three mash-eligible actions.
   *
   * Each successful roll is its own discrete mash tap, never a continuous
   * hold: ClashMash.ts's nextMashEventCount counts a real *press*
   * (pressedThisFrame) per tick, one event per tick with any qualifying
   * action. `commit()`'s held/previousHeld diffing exists to model a real
   * player's physical press/release (GDD section 113's shared controller
   * contract) — reusing its `pressedThisFrame` output here would silently
   * merge two consecutive rolls that happen to land on the same action
   * (~1/3 of the time, uniform over 3 options) into a single "hold",
   * under-counting the AI's genuine mash contribution against
   * personality.clashMashRatePerSecond (M7 audit regression). So
   * pressedThisFrame below always mirrors this tick's own `held` set —
   * this tick's roll, not a diff against the previous one — while `held`/
   * hold-duration bookkeeping still goes through clashMashActionSelector
   * for contract consistency.
   */
  private sampleClashMashActions(fixedDeltaSeconds: number): ControllerActions {
    const effectiveRate = Math.max(0, this.personality.clashMashRatePerSecond * this.difficulty.clashMashRateMultiplier);
    const mashProbabilityThisTick = Math.max(0, Math.min(1, effectiveRate * fixedDeltaSeconds));
    const held = new Set<Action>();
    if (this.rng.nextBool(mashProbabilityThisTick)) {
      const options = [Action.Attack, Action.JumpDrift, Action.Dodge];
      held.add(options[this.rng.nextInt(0, options.length - 1)] ?? Action.Attack);
    }
    const actions = this.clashMashActionSelector.commit(held, fixedDeltaSeconds);
    const mashActions: ControllerActions = { ...actions, pressedThisFrame: held };
    this.lastActionSummary = mashActions.pressedThisFrame.size > 0 ? 'clash mash' : 'clash — no mash this tick';
    return mashActions;
  }

  /** The difficulty multipliers this controller runs with — Debug Lab inspection only (GDD section 65: "difficulty modifiers"). */
  getDifficultyProfile(): AiDifficultyProfile {
    return this.difficulty;
  }

  getDebugState(): AiDebugState {
    const world = this.lastWorld;
    return {
      personalityId: this.personality.id,
      difficultyProfileId: this.difficulty.id,
      idealIntent: this.idealDecision.intent,
      idealIntentReason: this.idealDecision.reason,
      consideredScoresSummary: summarizeScores(this.idealDecision),
      consideredScores: this.idealDecision.consideredScores ?? [],
      clashWillingness: this.idealDecision.clashWillingness ?? 1,
      activeIntent: this.activeDecision.intent,
      activeIntentReason: this.activeDecision.reason,
      deliberateErrorApplied: this.deliberateErrorApplied,
      dodgeAttemptSucceeds: this.dodgeAttemptSucceeds,
      observedOpponentXZ: world ? world.targeting.observedOpponentXZ : { x: 0, z: 0 },
      predictedOpponentXZ: world ? world.targeting.predictedOpponentXZ : null,
      aimPositionXZ: world ? world.targeting.aimPositionXZ : { x: 0, z: 0 },
      predictionHorizonS: world ? world.targeting.predictionHorizonS : 0,
      predictionStrength: world ? world.targeting.predictionStrength : 0,
      distanceToOpponentM: world ? world.distanceToOpponentM : 0,
      edgeRiskFraction: this.lastRisk.edgeRisk,
      opponentThreatFraction: this.lastRisk.opponentThreat,
      selfVulnerabilityFraction: this.lastRisk.selfVulnerability,
      opportunityFraction: this.lastRisk.opportunity,
      reactionTimerS: this.decisionTimerS,
      pendingIntent: this.pendingDecision ? this.pendingDecision.intent : null,
      pendingDelayRemainingS: this.pendingDecision ? Math.max(0, this.pendingDelayRemainingS) : 0,
      chosenActionSummary: this.lastActionSummary,
      observedOpponentAggressionFraction: this.adaptation.getSnapshot().observedAggressionFraction,
      observedOpponentDodgeRate: this.adaptation.getSnapshot().observedDodgeRate,
      observedOpponentDashPreference: this.adaptation.getSnapshot().observedDashPreference,
    };
  }
}

function summarizeActions(actions: ControllerActions): string {
  if (actions.pressedThisFrame.has(Action.Dodge)) return 'dodge';
  if (actions.pressedThisFrame.has(Action.Attack)) return actions.held.has(Action.Attack) ? 'begin attack' : 'tap circular';
  if (actions.pressedThisFrame.has(Action.JumpDrift)) return 'jump/hop';
  if (actions.held.has(Action.Attack)) return 'charging dash';
  if (actions.held.has(Action.MoveForward)) return 'moving';
  return 'idle';
}
