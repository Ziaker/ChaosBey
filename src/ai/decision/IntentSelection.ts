// ============================================================
// AI INTENT SELECTION (MILESTONE 7)
// GDD section 62/65: layer 4/5 — scores each candidate AiIntent against the
// current WorldState + RiskAssessment, weighted by AiPersonality, and picks
// the highest-scoring one ("considered action scores where practical" —
// GDD section 65's debug requirement). Pure function: same inputs always
// produce the same intent (GDD section 81 determinism) — no RNG here.
// Deliberate imperfection (errorRate) is applied by IntentionalError.ts as
// a separate, explicit step over this function's output, not mixed into
// the scoring itself, so the "what would the AI ideally do" reasoning stays
// inspectable on its own (see AiDebugState.ts).
//
// Hard overrides sit above the normal scoring, matching the GDD's own
// priority language, in this order: an air-recovery window (section 21,
// M7 Part 2b); edge danger combined with a LIVE incoming hit, answered by an
// edge-safe evasion that is part of the recovery (Part 2b); edge danger
// alone (section 129); the Dash read (Part 2a: a telegraphed/incoming Dash
// answered with a timed Circular counter when this decision's pre-rolled
// counterDash says so); and an imminent hit (section 63). Any randomness is
// rolled by AIController and passed in, so this function stays pure.
// ============================================================

import { AttackState } from '../../combat/attacks/AttackController';
import { ClashState } from '../../combat/clash/ClashController';
import { computeStaminaFactor } from '../../combat/clash/ClashFormula';
import { CLASH_STAMINA_FACTOR_MAX, CLASH_STAMINA_FACTOR_MIN } from '../../combat/clash/ClashTuning';
import { DodgeState } from '../../dodge/DodgeController';
import { DriftState } from '../../drift/DriftController';
import type { AiPersonality } from '../personalities/AiPersonality';
import { AI_CIRCULAR_ATTACK_RANGE_M, AI_COUNTER_MIN_CLOSING_SPEED_MPS, AI_DASH_ATTACK_MAX_RANGE_M } from './AiCombatRanges';
import { AiIntent } from './Intent';
import type { RiskAssessment } from './RiskEvaluation';
import type { WorldState } from './WorldState';

/** Above this edgeRisk, recovering toward the center overrides normal intent scoring entirely (GDD section 129). */
/**
 * Owner, 2026-10-02 (Lote 3): how much full momentum boosts committing (Approach, Dash) (PROVISIONAL). Its straight
 * approaches are what build momentum; a bonus for circling to build it was tried and made patient AIs orbit each other
 * without ever resolving the round (defense vs defense, matrix-2/-4), so it is not used.
 */
const MOMENTUM_COMMIT_BONUS = 0.5;
/**
 * Owner item 11 follow-up (Lote 10): once a Bey is already moving, preserve a finite run-up instead of immediately
 * cashing every opening into another routine attack. At 60% momentum the current +100% default gain already raises
 * the top-speed ceiling to 1.6x, which is enough for the speed build-up to read before normal scoring resumes.
 * The target and score weights are PROVISIONAL playtest values; punish/counter/threat/edge overrides remain above this.
 */
const MOMENTUM_BUILD_TARGET = 0.6;
/** No artificial run-up from rest: normal scoring first gets the Bey moving. The pacing layer fades in from 2.5 to 5 m/s. */
const MOMENTUM_BUILD_MIN_SPEED_MPS = 2.5;
const MOMENTUM_BUILD_FULL_SPEED_MPS = 5;
/** At full build priority, routine attack scores keep 25%; tactical openings zero the priority and therefore bypass this. */
const MOMENTUM_BUILD_ATTACK_DAMPING = 0.75;
/** Additive score that keeps a moving, low-momentum Bey accelerating straight into the engagement before routine attacks. */
const MOMENTUM_BUILD_MOVE_BONUS = 0.8;
/** Circling/waiting are deliberately not the build-up answer: that experiment previously caused orbit stalemates. */
const MOMENTUM_BUILD_PASSIVE_DAMPING = 0.7;
/**
 * The speed-centered pacing must not erase the three approved personality reads. Patience already means "wait for a
 * better commitment": Attack therefore leans hardest into a run-up, Defense sits in the middle, and Stamina still gets
 * the system but preserves more of its patient/resource-saving behavior. With current data this yields 0.88 / 0.67 /
 * 0.52 for Attack / Defense / Stamina. PROVISIONAL, derived from an existing personality axis rather than a new trait.
 */
const MOMENTUM_BUILD_PATIENCE_WEIGHT = 0.6;
const MOMENTUM_BUILD_MIN_AFFINITY = 0.4;
/**
 * A run-up is a short combat beat, not another patience state. Keeping this fixed prevents the Stamina personality's
 * longer anti-passivity horizon from accidentally extending the momentum-build phase into a no-attack loop.
 */
const MOMENTUM_BUILD_MAX_DURATION_S = 3;
const EDGE_RISK_OVERRIDE_THRESHOLD = 0.55;
/** Once recovering, keep recovering until edgeRisk falls below this (hysteresis). Without it the AI stopped the moment it crossed back under the override threshold, turned to re-engage, and drifted straight back into danger. */
const EDGE_RISK_RELEASE_THRESHOLD = 0.3;
/** At/above this edge risk an evasive hop is never offered as the answer to a threat — a hop keeps its momentum and barely steers in the air, so near the edge it too easily becomes a self ring-out. */
const EVASIVE_JUMP_MAX_EDGE_RISK = 0.3;
/**
 * Opponent attack states whose hitbox is live right now. Edge recovery
 * yields to evasion only for these: a Buffering/ChargingDash telegraph is
 * not yet something that can hit, and getting off the wall is itself the
 * best preparation for it (the M7 Part 2a "edge danger outranks a counter
 * read" rule stays as approved).
 */
const LIVE_HITBOX_ATTACK_STATES: ReadonlySet<AttackState> = new Set([AttackState.CircularActive, AttackState.DashActive]);

/** How far up the threat scale AiPersonality.dodgeThrift pushes the point where a (non-edge) threat is answered with a Dodge rather than a sidestep — dodgeThrift 1 dodges only from THREAT_OVERRIDE_THRESHOLD + this. */
const DODGE_THRIFT_THREAT_MARGIN = 0.3;
/** AttackDash keeps (1 - this x reluctance) of its score, Approach (1 - APPROACH_...); Circle gains CIRCLE_... x reluctance — see collisionReluctance in selectIntent. */
const COLLISION_AVOIDANCE_DASH_DAMPING = 0.7;
const COLLISION_AVOIDANCE_APPROACH_DAMPING = 0.4;
const COLLISION_AVOIDANCE_CIRCLE_BONUS = 0.15;

/** Above this opponentThreat, answering the imminent hitbox overrides normal scoring — with WHICH answer (dodge, jump, or plain spacing) depending on what's actually available right now, never blindly picking dodge regardless of its cooldown. */
const THREAT_OVERRIDE_THRESHOLD = 0.35;

// ============================================================
// M7 PART 2 — TACTICAL SCORING TUNING
// Engineering placeholders (GDD section 167); each is scaled by the
// matching AiPersonality affinity, so archetypes differ by data, not code.
// ============================================================

/** Added to AttackCircular's score (x punishAffinity) while the opponent is in attack recovery within Circular range. */
const PUNISH_CIRCULAR_SCORE_BONUS = 0.45;
/** Added to AttackDash's score (x punishAffinity) while the opponent is in attack recovery within Dash range. */
const PUNISH_DASH_SCORE_BONUS = 0.35;
/** PressAdvantage's edge-pressure score = edgePressure x (BASE + edgePressureAffinity x AFFINITY_WEIGHT). */
const EDGE_PRESSURE_SCORE_BASE = 0.6;
const EDGE_PRESSURE_SCORE_AFFINITY_WEIGHT = 0.6;
/**
 * Anti-passivity tempo: the longer since this AI last started an attack,
 * the less Circle/Wait appeal — so even a patient personality eventually
 * engages instead of circling forever (a degenerate loop, not "patience").
 * Seconds until fully worn down = BASE x (1 + patience x PATIENCE_SCALE).
 */
const TEMPO_BASE_S = 4;
const TEMPO_PATIENCE_SCALE = 1.6;
/** At full tempo, Circle and Wait keep only (1 - this) of their normal score. */
const TEMPO_MAX_PASSIVE_DAMPING = 0.6;

// ============================================================
// CLASH WILLINGNESS TUNING (ported from PR #15)
// Engineering placeholders (GDD section 167). Willingness = BASE +
// aggression x AGGRESSION - caution x CAUTION + Stamina edge x STAMINA_EDGE,
// clamped to 0..1 (1 = attack as usual).
// ============================================================

const CLASH_WILLINGNESS_BASE = 0.65;
const CLASH_WILLINGNESS_AGGRESSION_WEIGHT = 0.5;
const CLASH_WILLINGNESS_CAUTION_WEIGHT = 0.45;
/** Per unit of Clash StaminaFactor advantage (own - opponent, over its full range): Clash power scales with it (ClashFormula), so a Stamina edge makes a Clash worth accepting. */
const CLASH_WILLINGNESS_STAMINA_EDGE_WEIGHT = 0.3;

export interface ConsideredScore {
  intent: AiIntent;
  score: number;
}

export interface IntentDecision {
  intent: AiIntent;
  /** Short human-readable justification — GDD section 65's "why a dodge/jump was chosen" debug requirement. */
  reason: string;
  /** Every candidate of the normal scoring pass with its score, highest first (GDD section 65: "considered action scores"); empty when an override decided (the reason says which). */
  consideredScores?: readonly ConsideredScore[];
  /** The clashWillingness multiplier the normal scoring pass applied to the attack candidates (1 = none); absent when an override decided. */
  clashWillingness?: number;
  /** True when this decision is part of getting away from the ring-out edge (RecoverFromEdge, or an edge-safe evasion of a live hit while in edge danger) — AIController keeps the lower release threshold (hysteresis) across such decisions, including an evasion in the middle of a recovery. */
  edgeRecovery?: boolean;
}

/**
 * Per-decision context AIController tracks across ticks, passed in so
 * selectIntent stays a pure function of its inputs: chance outcomes
 * pre-rolled from its seeded RNG, and its own recent history.
 */
export interface DecisionContext {
  /** Whether to answer the opponent's current Dash (telegraphed or incoming) with a Circular counter — AiPersonality.counterAffinity, rolled once per opponent Dash, not once per decision (re-rolling every reaction tick would converge on "always"). */
  readonly counterDash: boolean;
  /** Seconds since this AI last started an attack (or since the match began) — drives the anti-passivity tempo. */
  readonly secondsSinceOwnAttack: number;
  /** Whether the previous fresh decision was part of an edge recovery (IntentDecision.edgeRecovery) — selects the lower release threshold (hysteresis). */
  readonly recoveringFromEdge: boolean;
}

/** No chance outcome fires, no passivity has built up, no recovery in progress — the default for callers that don't track these (unit tests, pre-Part-2 behavior). */
export const NEUTRAL_DECISION_CONTEXT: DecisionContext = { counterDash: false, secondsSinceOwnAttack: 0, recoveringFromEdge: false };

/** 0..1 how worn down this personality's patience is after `secondsSinceOwnAttack` without attacking. */
export function passivityTempo(secondsSinceOwnAttack: number, personality: AiPersonality): number {
  const fullTempoS = TEMPO_BASE_S * (1 + personality.patience * TEMPO_PATIENCE_SCALE);
  return clamp01(secondsSinceOwnAttack / fullTempoS);
}

/**
 * Owner item 11: finite speed-build pacing for a Bey that is already moving. This deliberately does not create another
 * AI state machine. The current public momentum/speed plus the existing no-attack clock are enough to make the behavior
 * self-ending and deterministic:
 * - below Circular range: fight normally (already in contact; running away would look absurd);
 * - while moving and below the target: prefer a straight Approach over routine attacks; if contact happens before the
 *   target, that becomes the speed-difference body collision the owner explicitly asked for rather than a fake retreat;
 * - a punish/opening/edge-pressure or live Clash opportunity bypasses the pacing;
 * - patient archetypes use a gentler build bias, preserving their approved behavioral identity;
 * - the build phase itself has a fixed 3 s ceiling, then normal scoring resumes regardless of personality patience.
 */
export function momentumBuildPriority(
  world: WorldState,
  personality: AiPersonality,
  risk: RiskAssessment,
  context: DecisionContext = NEUTRAL_DECISION_CONTEXT,
): number {
  if (world.distanceToOpponentM <= AI_CIRCULAR_ATTACK_RANGE_M || world.own.momentum >= MOMENTUM_BUILD_TARGET) return 0;
  const speedGate = clamp01((world.own.speedMps - MOMENTUM_BUILD_MIN_SPEED_MPS) / (MOMENTUM_BUILD_FULL_SPEED_MPS - MOMENTUM_BUILD_MIN_SPEED_MPS));
  if (speedGate <= 0) return 0;
  const buildWindow = 1 - clamp01(context.secondsSinceOwnAttack / MOMENTUM_BUILD_MAX_DURATION_S);
  if (buildWindow <= 0) return 0;
  const buildNeed = clamp01((MOMENTUM_BUILD_TARGET - world.own.momentum) / MOMENTUM_BUILD_TARGET);
  const tacticalOpening = clamp01(
    Math.max(
      risk.opportunity,
      risk.punishWindow ? 1 : 0,
      risk.edgePressure,
      world.opponent.hasImminentHitbox ? 1 : 0,
    ),
  );
  const personalityAffinity = MOMENTUM_BUILD_MIN_AFFINITY + MOMENTUM_BUILD_PATIENCE_WEIGHT * (1 - personality.patience);
  return buildNeed * speedGate * personalityAffinity * buildWindow * (1 - tacticalOpening);
}

/**
 * True while the opponent's Dash is something a Circular counter could
 * answer: still charging within Dash range (the visible telegraph), or
 * already active and actually closing in. Own attack must be Neutral —
 * a counter is a fresh tap, not something to cancel into.
 */
export function isCounterableDash(world: WorldState): boolean {
  if (world.own.attackState !== AttackState.Neutral) return false;
  if (world.opponent.attackState === AttackState.ChargingDash) return world.distanceToOpponentM <= AI_DASH_ATTACK_MAX_RANGE_M;
  if (world.opponent.attackState === AttackState.DashActive) return world.closingSpeedMps >= AI_COUNTER_MIN_CLOSING_SPEED_MPS;
  return false;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/**
 * 0..1 multiplier on this AI's attack scores when attacking now would meet
 * the opponent's own live/imminent attack — the situation a Clash comes
 * from (both sides' hits connecting within the Clash window; GDD section
 * 42/63: the AI can create/accept Clash opportunities). Aggression leans
 * in, caution away, and a Stamina edge leans in (Clash power scales with
 * ClashFormula's StaminaFactor; both Stamina bars are visible). 1 when
 * there is nothing to accept: the opponent isn't attacking, or the Clash
 * system isn't Idle (on Cooldown a contested exchange resolves as a
 * weakened trade, not a Clash). A multiplier on scores, never a rule: it
 * can make an attack lose to another candidate, it never forces one.
 */
export function clashWillingness(world: WorldState, personality: AiPersonality): number {
  if (!world.opponent.hasImminentHitbox || world.clash.state !== ClashState.Idle) return 1;
  const staminaEdge =
    (computeStaminaFactor(world.own.staminaFraction) - computeStaminaFactor(world.opponent.staminaFraction)) /
    (CLASH_STAMINA_FACTOR_MAX - CLASH_STAMINA_FACTOR_MIN);
  return clamp01(
    CLASH_WILLINGNESS_BASE +
      personality.aggression * CLASH_WILLINGNESS_AGGRESSION_WEIGHT -
      personality.caution * CLASH_WILLINGNESS_CAUTION_WEIGHT +
      staminaEdge * CLASH_WILLINGNESS_STAMINA_EDGE_WEIGHT,
  );
}

export function selectIntent(
  world: WorldState,
  personality: AiPersonality,
  risk: RiskAssessment,
  context: DecisionContext = NEUTRAL_DECISION_CONTEXT,
): IntentDecision {
  // Highest priority: a real air-recovery window (GDD section 21) only
  // exists briefly after a launch, and everything else — edge danger
  // included — is easier to address with movement control restored.
  if (!world.own.grounded && world.own.airRecoveryAvailable) {
    return { intent: AiIntent.AirRecover, reason: 'airborne with an active air-recovery window' };
  }

  const edgeThreshold = context.recoveringFromEdge ? EDGE_RISK_RELEASE_THRESHOLD : EDGE_RISK_OVERRIDE_THRESHOLD;
  const inEdgeDanger = risk.edgeRisk >= edgeThreshold;
  const dodgeReady = world.own.dodgeState === DodgeState.Idle && world.own.canAffordDodge;

  // Edge danger AND a live hit coming: neither answer alone is safe.
  // Walking straight to the center ignores the hit (and the attacker may
  // be standing in that path); a normal evasion may leave toward the
  // wall. Answer the hit with an edge-safe evasion — sideways off its line,
  // pulled inward, never toward the attacker (ActionSelection's
  // evasionDirection) — as part of the recovery, so recovery resumes on
  // the next decision once the hit is gone (hysteresis kept throughout).
  if (inEdgeDanger && risk.opponentThreat >= THREAT_OVERRIDE_THRESHOLD && LIVE_HITBOX_ATTACK_STATES.has(world.opponent.attackState)) {
    const edge = `edge risk ${risk.edgeRisk.toFixed(2)} + live ${world.opponent.attackState} (threat ${risk.opponentThreat.toFixed(2)})`;
    if (dodgeReady) return { intent: AiIntent.DodgeThreat, reason: `${edge} — edge-safe dodge (inward/tangential)`, edgeRecovery: true };
    if (world.own.dodgeState === DodgeState.Dodging) {
      return { intent: AiIntent.DodgeThreat, reason: `${edge} — mid-dodge, staying grounded for the i-frames`, edgeRecovery: true };
    }
    // No dodge available: sidestep along the same edge-safe line on the
    // ground. Never a hop here (see EVASIVE_JUMP_MAX_EDGE_RISK).
    return {
      intent: AiIntent.DodgeThreat,
      reason: `${edge} — dodge ${world.own.canAffordDodge ? 'on cooldown' : 'unaffordable'}, sidestepping inward (no hop at the edge)`,
      edgeRecovery: true,
    };
  }
  if (inEdgeDanger) {
    return {
      intent: AiIntent.RecoverFromEdge,
      reason: context.recoveringFromEdge
        ? `edge risk ${risk.edgeRisk.toFixed(2)} — still recovering (until < ${EDGE_RISK_RELEASE_THRESHOLD})`
        : `edge risk ${risk.edgeRisk.toFixed(2)} over threshold`,
      edgeRecovery: true,
    };
  }
  if (context.counterDash && isCounterableDash(world)) {
    return {
      intent: AiIntent.CounterAttack,
      reason: `reading opponent ${world.opponent.attackState} at ${world.distanceToOpponentM.toFixed(1)} m — Circular counter`,
    };
  }
  if (risk.opponentThreat >= THREAT_OVERRIDE_THRESHOLD) {
    // GDD section 20: "a jump can count as an evasive action when it causes
    // an attack to miss" — Dodge is preferred when it's actually available,
    // but a real threat must still get *some* evasive answer instead of
    // silently falling through to normal scoring just because Dodge is on
    // cooldown (that previously left ActionSelection with nothing to press,
    // since it only ever presses Dodge from DodgeState.Idle).
    const threat = `opponent threat ${risk.opponentThreat.toFixed(2)}`;
    // GDD section 64 Stamina "preserves resources": a thrifty personality
    // sidesteps a threat that is not yet close instead of paying Stamina for
    // a Dodge — still an evasive answer (Circle leaves the attack line on
    // the center side), never ignoring it. Edge danger is handled above and
    // never thrifty.
    if (dodgeReady && risk.opponentThreat < THREAT_OVERRIDE_THRESHOLD + personality.dodgeThrift * DODGE_THRIFT_THREAT_MARGIN) {
      return { intent: AiIntent.Circle, reason: `${threat} — sidestepping, saving the Dodge (thrift)` };
    }
    if (dodgeReady) {
      return { intent: AiIntent.DodgeThreat, reason: `${threat} — dodging` };
    }
    // Mid-dodge: keep sliding off the line on the ground. Dodge i-frames
    // only exist while grounded (DodgeController), so hopping now would
    // throw away the protection the dodge just paid for.
    if (world.own.dodgeState === DodgeState.Dodging) {
      return { intent: AiIntent.DodgeThreat, reason: `${threat} — mid-dodge, staying grounded for the i-frames` };
    }
    const dodgeWhy = world.own.canAffordDodge ? 'on cooldown' : 'unaffordable (not enough Stamina)';
    if (world.own.driftState === DriftState.Idle && world.own.grounded && risk.edgeRisk < EVASIVE_JUMP_MAX_EDGE_RISK) {
      return { intent: AiIntent.UseJumpDrift, reason: `${threat} — dodge ${dodgeWhy}, jumping instead` };
    }
    return {
      intent: AiIntent.Retreat,
      reason: `${threat} — dodge ${dodgeWhy}, ${risk.edgeRisk >= EVASIVE_JUMP_MAX_EDGE_RISK ? 'too close to the edge to hop' : 'jump unavailable'}, creating distance`,
    };
  }

  // Never try to attack while already mid-attack (Buffering/Charging/Active
  // states resolve on their own timers) — the AI simply keeps whatever
  // ActionSelection.ts derives for holding the attack button, not a fresh
  // intent every tick.
  const alreadyAttacking =
    world.own.attackState !== AttackState.Neutral &&
    world.own.attackState !== AttackState.DashRecovery &&
    world.own.attackState !== AttackState.CircularRecovery;

  const inCircularRange = world.distanceToOpponentM <= AI_CIRCULAR_ATTACK_RANGE_M;
  const inDashRange = world.distanceToOpponentM > AI_CIRCULAR_ATTACK_RANGE_M && world.distanceToOpponentM <= AI_DASH_ATTACK_MAX_RANGE_M;

  // GDD section 64 Stamina "avoids unnecessary heavy collisions": closing
  // in and Dash commitments lose appeal unless the opponent is actually open
  // (opportunity or a punish window), in proportion to collisionAvoidance.
  // It wears off with the same anti-passivity tempo that damps Circle/Wait
  // — avoiding collisions must never become "never engage".
  const tempo = passivityTempo(context.secondsSinceOwnAttack, personality);
  const opening = Math.max(risk.opportunity, risk.punishWindow ? 1 : 0);
  const collisionReluctance = clamp01(personality.collisionAvoidance * (1 - opening) * (1 - tempo));
  const buildPriority = momentumBuildPriority(world, personality, risk, context);
  const routineAttackScale = 1 - buildPriority * MOMENTUM_BUILD_ATTACK_DAMPING;

  const scores = new Map<AiIntent, number>();
  const willingness = clashWillingness(world, personality);

  // Two kinds of advantage feed PressAdvantage: a weakened opponent, or one
  // near the ring-out edge (ActionSelection approaches the latter from the
  // center side so the hit drives them outward).
  const stabilityAdvantage = risk.opportunity * (0.5 + personality.aggression * 0.5);
  const edgeAdvantage = risk.edgePressure * (EDGE_PRESSURE_SCORE_BASE + personality.edgePressureAffinity * EDGE_PRESSURE_SCORE_AFFINITY_WEIGHT);
  scores.set(AiIntent.PressAdvantage, Math.max(stabilityAdvantage, edgeAdvantage) * willingness * (inCircularRange || inDashRange ? 1 : 0.3));

  // A visible recovery window (whiffed/spent attack) invites a punish —
  // how strongly depends on the personality (GDD section 64 Defense).
  const punishBonus = risk.punishWindow ? personality.punishAffinity : 0;

  scores.set(
    AiIntent.AttackCircular,
    inCircularRange && !alreadyAttacking
      ? (0.4 + personality.aggression * 0.4 - personality.caution * 0.2 + punishBonus * PUNISH_CIRCULAR_SCORE_BONUS) * willingness * routineAttackScale
      : 0,
  );

  scores.set(
    AiIntent.AttackDash,
    inDashRange && !alreadyAttacking && world.own.dashReadiness >= 1
      ? (0.3 + personality.aggression * 0.5 - personality.patience * 0.2 + punishBonus * PUNISH_DASH_SCORE_BONUS) *
          willingness *
          (1 - collisionReluctance * COLLISION_AVOIDANCE_DASH_DAMPING) *
          routineAttackScale
      : 0,
  );

  const tooClose = world.distanceToOpponentM < personality.preferredEngageRangeM * 0.6;
  const tooFar = world.distanceToOpponentM > personality.preferredEngageRangeM * 1.6;

  scores.set(
    AiIntent.Approach,
    (tooFar ? 0.6 : 0.2) *
      (0.4 + personality.aggression * 0.6) *
      (1 - risk.selfVulnerability * 0.5) *
      (1 - collisionReluctance * COLLISION_AVOIDANCE_APPROACH_DAMPING),
  );

  scores.set(
    AiIntent.Retreat,
    (tooClose ? 0.55 : 0.15) * (0.3 + personality.caution * 0.7) * (0.4 + risk.selfVulnerability * 0.6),
  );

  const passiveDamping = 1 - tempo * TEMPO_MAX_PASSIVE_DAMPING;

  scores.set(
    AiIntent.Circle,
    ((!tooClose && !tooFar ? 0.35 + personality.patience * 0.3 : 0.1) + collisionReluctance * COLLISION_AVOIDANCE_CIRCLE_BONUS) * passiveDamping,
  );
  scores.set(AiIntent.Wait, alreadyAttacking ? 0 : personality.patience * 0.15 * passiveDamping);

  // Item 11 follow-up: keep the run-up straight. Retreat can reverse the throttle and throw momentum away, while the
  // previously-tried Circle bonus could orbit forever. Approach is forward-only; if the Bey reaches the opponent before
  // 60% momentum, the contact resolves through the real speed-difference body-collision mechanic instead of inventing
  // a hidden spacing move. Tactical openings still bypass this layer entirely.
  if (buildPriority > 0) {
    scores.set(AiIntent.Approach, (scores.get(AiIntent.Approach) ?? 0) + buildPriority * MOMENTUM_BUILD_MOVE_BONUS);
    const passiveScale = 1 - buildPriority * MOMENTUM_BUILD_PASSIVE_DAMPING;
    scores.set(AiIntent.Circle, (scores.get(AiIntent.Circle) ?? 0) * passiveScale);
    scores.set(AiIntent.Wait, (scores.get(AiIntent.Wait) ?? 0) * passiveScale);
  }

  // Momentum already built: its raised top speed, harder body collisions and faster Dash entry make commitment more
  // valuable. This is deliberately separate from the run-up pacing above: one builds speed, the other cashes it in.
  const own = world.own.momentum;
  scores.set(AiIntent.Approach, (scores.get(AiIntent.Approach) ?? 0) * (1 + own * MOMENTUM_COMMIT_BONUS));
  scores.set(AiIntent.AttackDash, (scores.get(AiIntent.AttackDash) ?? 0) * (1 + own * MOMENTUM_COMMIT_BONUS));

  // Below the hard override threshold, a milder threat with Dodge already
  // on cooldown still nudges normal scoring toward a preemptive jump — the
  // threat->threshold override above handles anything at/past
  // THREAT_OVERRIDE_THRESHOLD directly.
  scores.set(
    AiIntent.UseJumpDrift,
    risk.edgeRisk >= EVASIVE_JUMP_MAX_EDGE_RISK
      ? 0
      : world.opponent.hasImminentHitbox && world.own.dodgeState === DodgeState.Cooldown && risk.opponentThreat > 0.15
        ? 0.5
        : 0.05,
  );

  let bestIntent = AiIntent.Circle;
  let bestScore = -Infinity;
  for (const [intent, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  // Stable (score desc, then insertion order) so debug/telemetry output is
  // deterministic.
  const consideredScores = [...scores.entries()].map(([intent, score]) => ({ intent, score })).sort((a, b) => b.score - a.score);
  const buildReason = buildPriority > 0.01 ? `; momentum build ${world.own.momentum.toFixed(2)}→${MOMENTUM_BUILD_TARGET.toFixed(2)} (${buildPriority.toFixed(2)})` : '';

  return {
    intent: bestIntent,
    reason: `best score ${clamp01(bestScore).toFixed(2)} among ${scores.size} candidates${buildReason}`,
    consideredScores,
    clashWillingness: willingness,
  };
}
