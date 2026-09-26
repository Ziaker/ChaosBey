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
// Two hard overrides sit above the normal scoring, matching the GDD's own
// priority language: edge danger and an imminent incoming hit are things
// the AI "should" react to (section 129/63), not merely weigh against
// unrelated goals like a normal attack decision. Between them sits the
// Dash read (M7 Part 2): a telegraphed/incoming Dash is answered with a
// timed Circular counter when this decision's pre-rolled counterDash says
// so (see DecisionContext) — any randomness is rolled by AIController and
// passed in, so this function itself stays pure.
// ============================================================

import { AttackState } from '../../combat/attacks/AttackController';
import { DodgeState } from '../../dodge/DodgeController';
import { DriftState } from '../../drift/DriftController';
import type { AiPersonality } from '../personalities/AiPersonality';
import { AI_CIRCULAR_ATTACK_RANGE_M, AI_COUNTER_MIN_CLOSING_SPEED_MPS, AI_DASH_ATTACK_MAX_RANGE_M } from './AiCombatRanges';
import { AiIntent } from './Intent';
import type { RiskAssessment } from './RiskEvaluation';
import type { WorldState } from './WorldState';

/** Above this edgeRisk, recovering toward the center overrides normal intent scoring entirely (GDD section 129). */
const EDGE_RISK_OVERRIDE_THRESHOLD = 0.55;
/** Once recovering, keep recovering until edgeRisk falls below this (hysteresis). Without it the AI stopped the moment it crossed back under the override threshold, turned to re-engage, and drifted straight back into danger. */
const EDGE_RISK_RELEASE_THRESHOLD = 0.3;
/** At/above this edgeRisk, every edge-episode decision (recovering, or evading while in edge danger) is critical: IntentionalError.ts never downgrades or delays it. */
export const CRITICAL_EDGE_RISK = 0.85;
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
/** How many of the best-scoring candidates a decision keeps for the debug overlay (GDD section 65: "considered action scores where practical"). */
const CONSIDERED_SCORES_KEPT = 3;
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

export interface ConsideredScore {
  intent: AiIntent;
  score: number;
}

export interface IntentDecision {
  intent: AiIntent;
  /** Short human-readable justification — GDD section 65's "why a dodge/jump was chosen" debug requirement. */
  reason: string;
  /** Best-scoring candidates of the normal scoring pass, highest first; empty when an override decided (the reason says which). */
  consideredScores?: readonly ConsideredScore[];
  /** Part of an edge-recovery episode: recovering, or evading a hit while in edge danger. The next decision keeps the lower release threshold while this holds, so evading never ends the recovery early. */
  edgeEpisode?: boolean;
  /** Must never be downgraded or delayed by a deliberate error (IntentionalError.ts). */
  critical?: boolean;
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
  /** Whether the previous decision was part of an edge episode (see IntentDecision.edgeEpisode) — selects the lower release threshold (hysteresis). */
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

/** A Dodge press would start a ground dodge right now (Idle, enough Stamina, grounded) — see PerceivedCombatant.dodgeReady. */
function canGroundDodge(world: WorldState): boolean {
  return world.own.dodgeState === DodgeState.Idle && world.own.dodgeReady && world.own.grounded;
}

/** Edge danger + an immediate hit: the best evasion that is actually available, each carried out toward the safe side by ActionSelection. */
function edgeSafeEvasion(world: WorldState, risk: RiskAssessment): IntentDecision {
  const situation = `edge risk ${risk.edgeRisk.toFixed(2)} + immediate ${world.opponent.attackState}`;
  if (world.own.dodgeState === DodgeState.Dodging) {
    return { intent: AiIntent.DodgeThreat, reason: `${situation} — already dodging, keeping the i-frames` };
  }
  if (canGroundDodge(world)) {
    return { intent: AiIntent.DodgeThreat, reason: `${situation} — dodging inward/sideways` };
  }
  if (world.own.driftState === DriftState.Idle && world.own.grounded) {
    return { intent: AiIntent.JumpEvade, reason: `${situation} — dodge unavailable, jumping` };
  }
  return { intent: AiIntent.Retreat, reason: `${situation} — no dodge or jump, moving to the safest side` };
}

export function selectIntent(
  world: WorldState,
  personality: AiPersonality,
  risk: RiskAssessment,
  context: DecisionContext = NEUTRAL_DECISION_CONTEXT,
): IntentDecision {
  const edgeThreshold = context.recoveringFromEdge ? EDGE_RISK_RELEASE_THRESHOLD : EDGE_RISK_OVERRIDE_THRESHOLD;
  if (risk.edgeRisk >= edgeThreshold) {
    const critical = risk.edgeRisk >= CRITICAL_EDGE_RISK;
    // Edge danger and an immediate hit at once: evade in a way that keeps
    // the AI in the ring, then (next decision, same episode) go back to
    // recovering. A telegraph (charging Dash) is not immediate — getting
    // away from the edge is the answer to that.
    if (risk.immediateThreat) return { ...edgeSafeEvasion(world, risk), edgeEpisode: true, critical };
    return {
      intent: AiIntent.RecoverFromEdge,
      reason: context.recoveringFromEdge
        ? `edge risk ${risk.edgeRisk.toFixed(2)} — still recovering (until < ${EDGE_RISK_RELEASE_THRESHOLD})`
        : `edge risk ${risk.edgeRisk.toFixed(2)} over threshold`,
      edgeEpisode: true,
      critical,
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
    // Mid-dodge, the i-frames ARE the evasion — and they only hold while
    // grounded, so jumping now would throw them away.
    if (world.own.dodgeState === DodgeState.Dodging) {
      return { intent: AiIntent.DodgeThreat, reason: `opponent threat ${risk.opponentThreat.toFixed(2)} — already dodging, keeping the i-frames` };
    }
    if (canGroundDodge(world)) {
      return { intent: AiIntent.DodgeThreat, reason: `opponent threat ${risk.opponentThreat.toFixed(2)} — dodging` };
    }
    if (world.own.driftState === DriftState.Idle && world.own.grounded) {
      return { intent: AiIntent.UseJumpDrift, reason: `opponent threat ${risk.opponentThreat.toFixed(2)} — dodge on cooldown, jumping instead` };
    }
    return { intent: AiIntent.Retreat, reason: `opponent threat ${risk.opponentThreat.toFixed(2)} — dodge and jump both unavailable, creating distance` };
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

  const scores = new Map<AiIntent, number>();

  // Two kinds of advantage feed PressAdvantage: a weakened opponent, or one
  // near the ring-out edge (ActionSelection approaches the latter from the
  // center side so the hit drives them outward).
  const stabilityAdvantage = risk.opportunity * (0.5 + personality.aggression * 0.5);
  const edgeAdvantage = risk.edgePressure * (EDGE_PRESSURE_SCORE_BASE + personality.edgePressureAffinity * EDGE_PRESSURE_SCORE_AFFINITY_WEIGHT);
  scores.set(AiIntent.PressAdvantage, Math.max(stabilityAdvantage, edgeAdvantage) * (inCircularRange || inDashRange ? 1 : 0.3));

  // A visible recovery window (whiffed/spent attack) invites a punish —
  // how strongly depends on the personality (GDD section 64 Defense).
  const punishBonus = risk.punishWindow ? personality.punishAffinity : 0;

  scores.set(
    AiIntent.AttackCircular,
    inCircularRange && !alreadyAttacking
      ? 0.4 + personality.aggression * 0.4 - personality.caution * 0.2 + punishBonus * PUNISH_CIRCULAR_SCORE_BONUS
      : 0,
  );

  scores.set(
    AiIntent.AttackDash,
    inDashRange && !alreadyAttacking && world.own.attackEnergyFraction > 0.25
      ? 0.3 + personality.aggression * 0.5 - personality.patience * 0.2 + punishBonus * PUNISH_DASH_SCORE_BONUS
      : 0,
  );

  const tooClose = world.distanceToOpponentM < personality.preferredEngageRangeM * 0.6;
  const tooFar = world.distanceToOpponentM > personality.preferredEngageRangeM * 1.6;

  scores.set(
    AiIntent.Approach,
    (tooFar ? 0.6 : 0.2) * (0.4 + personality.aggression * 0.6) * (1 - risk.selfVulnerability * 0.5),
  );

  scores.set(
    AiIntent.Retreat,
    (tooClose ? 0.55 : 0.15) * (0.3 + personality.caution * 0.7) * (0.4 + risk.selfVulnerability * 0.6),
  );

  const passiveDamping = 1 - passivityTempo(context.secondsSinceOwnAttack, personality) * TEMPO_MAX_PASSIVE_DAMPING;

  scores.set(AiIntent.Circle, (!tooClose && !tooFar ? 0.35 + personality.patience * 0.3 : 0.1) * passiveDamping);

  scores.set(AiIntent.Wait, alreadyAttacking ? 0 : personality.patience * 0.15 * passiveDamping);

  // Below the hard override threshold, a milder threat with Dodge already
  // on cooldown still nudges normal scoring toward a preemptive jump — the
  // threat->threshold override above handles anything at/past
  // THREAT_OVERRIDE_THRESHOLD directly.
  scores.set(
    AiIntent.UseJumpDrift,
    world.opponent.hasImminentHitbox && world.own.dodgeState === DodgeState.Cooldown && risk.opponentThreat > 0.15 ? 0.5 : 0.05,
  );

  let bestIntent = AiIntent.Circle;
  let bestScore = -Infinity;
  for (const [intent, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  const consideredScores = [...scores.entries()]
    .map(([intent, score]) => ({ intent, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CONSIDERED_SCORES_KEPT);

  return { intent: bestIntent, reason: `best score ${clamp01(bestScore).toFixed(2)} among ${scores.size} candidates`, consideredScores };
}
