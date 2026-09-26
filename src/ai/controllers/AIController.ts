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
import { DodgeState } from '../../dodge/DodgeController';
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
import type { AiDifficultyProfile } from '../difficulty/AiDifficultyProfile';
import { maybeApplyIntentionalError } from '../errors/IntentionalError';
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

function summarizeScores(scores: readonly ConsideredScore[] | undefined): string {
  if (!scores || scores.length === 0) return 'override (see reason)';
  return scores.map((entry) => `${entry.intent} ${entry.score.toFixed(2)}`).join(' / ');
}

function extractRawState(physics: PhysicsWorld, body: RAPIER.RigidBody, bey: Bey): CombatantRawState {
  const translation = body.translation();
  const velocity = body.linvel();
  const grounded = isGrounded(physics, bey.collider);
  return {
    positionXZ: { x: translation.x, z: translation.z },
    velocityXZ: { x: velocity.x, z: velocity.z },
    headingRad: bey.movement.getHeadingRad(),
    grounded,
    attackState: bey.attack.getState(),
    dashChargeFraction: bey.attack.getChargeFraction(),
    dodgeState: bey.dodge.getState(),
    driftState: bey.drift.getState(),
    staminaFraction: bey.stamina.resource.fraction,
    stabilityFraction: bey.stability.resource.fraction,
    isBroken: bey.stability.isBroken,
    attackEnergyFraction: bey.attackEnergy.resource.fraction,
    dodgeReady: bey.dodge.getState() === DodgeState.Idle && bey.stamina.resource.value >= DODGE_STAMINA_COST,
    // Same grounded value tickMatch passes DodgeController on the coming
    // tick (nothing moves in between), so this is exactly "a press now
    // triggers air recovery" — see CombatantRawState.airRecoveryAvailable.
    airRecoveryAvailable: bey.dodge.isAirRecoveryAvailable() && !grounded,
  };
}

const ZERO_RISK: RiskAssessment = { edgeRisk: 0, opponentThreat: 0, selfVulnerability: 0, opportunity: 0, punishWindow: false, edgePressure: 0, immediateThreat: false };

export class AIController implements CombatController {
  private readonly actionSelector = new ActionSelector();
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

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly ownBey: Bey,
    private readonly opponentBey: Bey,
    private readonly clashController: ClashController,
    private readonly personality: AiPersonality,
    private readonly difficulty: AiDifficultyProfile,
    private readonly rng: SeededRng,
    private readonly telemetry: TelemetryRecorder | null = null,
  ) {}

  sampleActions(context: ControllerContext): ControllerActions {
    if (context.simulationFrozen) {
      return this.actionSelector.repeatFrozenActions(context.fixedDeltaSeconds);
    }

    if (this.clashController.getState() === ClashState.Active) {
      return this.sampleClashMashActions(context.fixedDeltaSeconds);
    }

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
    // An open air-recovery window (GDD section 21) outranks every
    // commitment: being launched mid-swing or mid-hop must not lock the AI
    // out of the one action that answers it. It still waits for the normal
    // decision cadence (reaction delay) like any other reaction.
    const airRecoveryWindowOpen = ownPerceived.airRecoveryAvailable;
    const committed = !airRecoveryWindowOpen && (committedToAttack || committedToDrift || committedToCounter);

    const effectiveReactionDelayS = Math.max(0, this.personality.reactionDelaySeconds * this.difficulty.reactionDelayMultiplier);
    this.decisionTimerS += context.fixedDeltaSeconds;
    if (!committed && this.decisionTimerS >= effectiveReactionDelayS) {
      this.decisionTimerS = 0;
      this.makeFreshDecision(world);
    }

    const actions = this.actionSelector.selectActions(this.activeDecision.intent, world, this.personality, this.dodgeAttemptSucceeds, context.fixedDeltaSeconds);
    this.lastActionSummary = summarizeActions(actions);
    return actions;
  }

  private makeFreshDecision(world: WorldState): void {
    this.adaptation.update(world.opponent, ADAPTATION_BASE_ALPHA * this.clampedAdaptationRate());
    const adjustedPersonality = applyAdaptationNudge(this.personality, this.adaptation.getSnapshot(), this.clampedAdaptationRate());

    const risk = evaluateRisk(world, adjustedPersonality);
    this.lastRisk = risk;

    const ideal = selectIntent(world, adjustedPersonality, risk, {
      counterDash: this.counterRollForOpponentDash === true,
      secondsSinceOwnAttack: world.nowS - this.lastOwnAttackStartS,
      // From the ideal decision, so a deliberate-error downgrade can't end
      // an edge episode early.
      recoveringFromEdge: this.idealDecision.edgeEpisode === true,
    });
    this.idealDecision = ideal;

    const { decision, errorApplied } = maybeApplyIntentionalError(ideal, risk, adjustedPersonality, this.difficulty, this.rng);
    this.activeDecision = decision;
    this.deliberateErrorApplied = errorApplied;

    // Rolled exactly once for this fresh decision (see the field's own doc
    // comment) — a no-op (stays false) for every other intent.
    this.dodgeAttemptSucceeds = decision.intent === AiIntent.DodgeThreat ? this.rng.nextBool(adjustedPersonality.dodgeSkill) : false;

    if (this.telemetry) {
      this.telemetry.record({
        kind: TelemetryEventKind.AiDecision,
        personalityId: this.personality.id,
        intent: decision.intent,
        reason: decision.reason,
        deliberateErrorApplied: errorApplied,
        edgeRiskFraction: risk.edgeRisk,
        opponentThreatFraction: risk.opponentThreat,
      });
    }
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
   * if so picks one of the three mash-eligible actions — see
   * ClashMash.ts's nextMashEventCount for why holding the same action
   * across consecutive ticks would under-count versus a fresh press each
   * time.
   */
  private sampleClashMashActions(fixedDeltaSeconds: number): ControllerActions {
    const effectiveRate = Math.max(0, this.personality.clashMashRatePerSecond * this.difficulty.clashMashRateMultiplier);
    const mashProbabilityThisTick = Math.max(0, Math.min(1, effectiveRate * fixedDeltaSeconds));
    const held = new Set<Action>();
    if (this.rng.nextBool(mashProbabilityThisTick)) {
      const options = [Action.Attack, Action.JumpDrift, Action.Dodge];
      held.add(options[this.rng.nextInt(0, options.length - 1)] ?? Action.Attack);
    }
    const actions = this.actionSelector.commit(held, fixedDeltaSeconds);
    this.lastActionSummary = actions.pressedThisFrame.size > 0 ? 'clash mash' : 'clash — no mash this tick';
    return actions;
  }

  getDebugState(): AiDebugState {
    const world = this.lastWorld;
    return {
      personalityId: this.personality.id,
      difficultyProfileId: this.difficulty.id,
      idealIntent: this.idealDecision.intent,
      idealIntentReason: this.idealDecision.reason,
      consideredScoresSummary: summarizeScores(this.idealDecision.consideredScores),
      activeIntent: this.activeDecision.intent,
      activeIntentReason: this.activeDecision.reason,
      deliberateErrorApplied: this.deliberateErrorApplied,
      dodgeAttemptSucceeds: this.dodgeAttemptSucceeds,
      targetPositionXZ: world ? world.opponent.positionXZ : { x: 0, z: 0 },
      distanceToOpponentM: world ? world.distanceToOpponentM : 0,
      edgeRiskFraction: this.lastRisk.edgeRisk,
      opponentThreatFraction: this.lastRisk.opponentThreat,
      selfVulnerabilityFraction: this.lastRisk.selfVulnerability,
      opportunityFraction: this.lastRisk.opportunity,
      reactionTimerS: this.decisionTimerS,
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
