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
import { ClashState, type ClashController } from '../../combat/clash/ClashController';
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
import { selectIntent, type IntentDecision } from '../decision/IntentSelection';
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
  return intent === AiIntent.AttackCircular || intent === AiIntent.AttackDash || intent === AiIntent.PressAdvantage;
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
    attackEnergyFraction: bey.attackEnergy.resource.fraction,
  };
}

const ZERO_RISK: RiskAssessment = { edgeRisk: 0, opponentThreat: 0, selfVulnerability: 0, opportunity: 0 };

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
    );
    this.lastWorld = world;

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
    const committed = committedToAttack || committedToDrift;

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

    const ideal = selectIntent(world, adjustedPersonality, risk);
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
