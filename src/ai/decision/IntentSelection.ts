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
// Three hard overrides sit above the normal scoring, matching the GDD's own
// priority language: being airborne with a real recovery opportunity, edge
// danger, and an imminent incoming hit are things the AI "should" react to
// (section 21/129/63), not merely weigh against unrelated goals like a
// normal attack decision.
// ============================================================

import { AttackState } from '../../combat/attacks/AttackController';
import { DodgeState } from '../../dodge/DodgeController';
import { DriftState } from '../../drift/DriftController';
import type { AiPersonality } from '../personalities/AiPersonality';
import { AI_CIRCULAR_ATTACK_RANGE_M, AI_DASH_ATTACK_MAX_RANGE_M } from './AiCombatRanges';
import { RINGOUT_RADIUS_M } from '../../arena/ringout/RingOutTuning';
import { AiIntent } from './Intent';
import type { RiskAssessment } from './RiskEvaluation';
import type { WorldState } from './WorldState';

/** Above this edgeRisk, recovering toward the center overrides normal intent scoring entirely (GDD section 129). */
const EDGE_RISK_OVERRIDE_THRESHOLD = 0.55;
/** Above this opponentThreat, answering the imminent hitbox overrides normal scoring — with WHICH answer (dodge, jump, or plain spacing) depending on what's actually available right now, never blindly picking dodge regardless of its cooldown. */
const THREAT_OVERRIDE_THRESHOLD = 0.35;
/** At/above this edge risk an evasive hop is not offered as the answer to a threat — a hop keeps its momentum and cannot be steered much in the air, so near the edge it too easily becomes a self ring-out (Retreat, which bends toward the center, is used instead). */
const EVASIVE_JUMP_MAX_EDGE_RISK = 0.3;
/** How much further up the threat scale AiPersonality.dodgeThrift can push the point where a threat is answered with a Dodge rather than a sidestep (dodgeThrift 1 -> only at THREAT_OVERRIDE_THRESHOLD + this). */
const DODGE_THRIFT_THREAT_MARGIN = 0.3;
/** Seconds of standoff (nobody attacking) before impatience starts building (see selectIntent). */
const IMPATIENCE_START_S = 4;
/** Seconds over which impatience ramps from nothing to its full weight after IMPATIENCE_START_S. */
const IMPATIENCE_RAMP_S = 6;

/** Own distance from the center, as a fraction of RINGOUT_RADIUS_M, beyond which AiPersonality.centerControl starts pulling back toward the middle between exchanges. */
const CENTER_CONTROL_START_FRACTION = 0.35;

export interface IntentScore {
  intent: AiIntent;
  score: number;
}

export interface IntentDecision {
  intent: AiIntent;
  /** Short human-readable justification — GDD section 65's "why a dodge/jump was chosen" debug requirement. */
  reason: string;
  /** Every candidate's score, best first — GDD section 65's "considered action scores where practical". Empty when a hard override decided without scoring. */
  scores?: readonly IntentScore[];
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

export function selectIntent(world: WorldState, personality: AiPersonality, risk: RiskAssessment): IntentDecision {
  // Highest priority: a real air-recovery window (GDD section 21) is only
  // ever open for a short time after a launch, and everything else —
  // edge danger included — is easier to address with movement control
  // restored than while still tumbling from a knockback.
  if (!world.own.grounded && world.own.airRecoveryAvailable) {
    return { intent: AiIntent.AirRecover, reason: 'airborne with an active air-recovery window' };
  }
  if (risk.edgeRisk >= EDGE_RISK_OVERRIDE_THRESHOLD) {
    return { intent: AiIntent.RecoverFromEdge, reason: `edge risk ${risk.edgeRisk.toFixed(2)} over threshold` };
  }
  if (risk.opponentThreat >= THREAT_OVERRIDE_THRESHOLD) {
    // GDD section 20: "a jump can count as an evasive action when it causes
    // an attack to miss" — Dodge is preferred when it's actually available,
    // but a real threat must still get *some* evasive answer instead of
    // silently falling through to normal scoring just because Dodge is on
    // cooldown (that previously left ActionSelection with nothing to press,
    // since it only ever presses Dodge from DodgeState.Idle).
    // GDD section 64 Stamina "preserves resources": a thrifty personality
    // sidesteps a threat that is not yet close instead of paying Stamina
    // for a Dodge — still an evasive answer (Circle moves off the attack
    // line toward the center), never ignoring the threat.
    const dodgeThreshold = THREAT_OVERRIDE_THRESHOLD + personality.dodgeThrift * DODGE_THRIFT_THREAT_MARGIN;
    const dodgeReady = world.own.dodgeState === DodgeState.Idle && world.own.canAffordDodge;
    if (dodgeReady && risk.opponentThreat < dodgeThreshold) {
      return { intent: AiIntent.Circle, reason: `opponent threat ${risk.opponentThreat.toFixed(2)} — sidestepping, saving the dodge (thrift)` };
    }
    if (dodgeReady) {
      return { intent: AiIntent.DodgeThreat, reason: `opponent threat ${risk.opponentThreat.toFixed(2)} — dodging` };
    }
    // Mid-dodge: keep sliding off the attack line on the ground. Dodge
    // i-frames only exist while grounded (DodgeController), so hopping now
    // would throw away the protection the dodge just paid for.
    if (world.own.dodgeState === DodgeState.Dodging) {
      return { intent: AiIntent.DodgeThreat, reason: `opponent threat ${risk.opponentThreat.toFixed(2)} — mid-dodge, staying grounded for the i-frames` };
    }
    if (world.own.driftState === DriftState.Idle && world.own.grounded && risk.edgeRisk < EVASIVE_JUMP_MAX_EDGE_RISK) {
      return {
        intent: AiIntent.UseJumpDrift,
        reason: `opponent threat ${risk.opponentThreat.toFixed(2)} — dodge ${world.own.canAffordDodge ? 'on cooldown' : 'unaffordable (not enough Stamina)'}, jumping instead`,
      };
    }
    return {
      intent: AiIntent.Retreat,
      reason: `opponent threat ${risk.opponentThreat.toFixed(2)} — dodge unavailable${world.own.canAffordDodge ? '' : ' (not enough Stamina)'}${risk.edgeRisk >= EVASIVE_JUMP_MAX_EDGE_RISK ? ', too close to the edge to hop' : ', jump unavailable'}, creating distance`,
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

  // GDD section 42/63: AI can "intentionally create/accept Clash
  // opportunities". An opponent with an imminent hitbox but still below
  // THREAT_OVERRIDE_THRESHOLD (handled above) is a near-simultaneous-attack
  // situation rather than a one-sided threat — an aggressive personality
  // leans into finishing its own swing (accepting the Clash it might cause),
  // a cautious one leans away from committing into it. 1 when the opponent
  // has no imminent hitbox at all (nothing to accept or avoid).
  const clashWillingness = world.opponent.hasImminentHitbox
    ? clamp01(0.65 + personality.aggression * 0.5 - personality.caution * 0.45)
    : 1;

  // GDD section 30/64 Stamina: low Stamina should make resource-heavy
  // offense (closing distance, committing to a Dash charge) less
  // attractive in proportion to how much this personality values
  // conserving resources (patience) — never an input-responsiveness
  // penalty (GDD section 30 forbids that), only a preference shift in what
  // the AI chooses to attempt.
  const resourceConservation = clamp01(personality.patience * (1 - world.own.staminaFraction));

  // GDD section 64 Stamina "avoids unnecessary heavy collisions": closing
  // in and Dash commitments lose appeal unless the opponent is actually
  // open (opportunity), in proportion to collisionAvoidance.
  const collisionReluctance = clamp01(personality.collisionAvoidance * (1 - risk.opportunity));

  // Standoff impatience: two cautious personalities could otherwise circle
  // at their preferred range forever, each waiting for the other to commit
  // (seen in AI-vs-AI Defense mirrors — tens of seconds without a single
  // attack). The longer nobody attacks, the more offense appeals and
  // waiting/circling doesn't; patience slows it but never cancels it.
  const impatience =
    clamp01((world.secondsSinceEngagement - IMPATIENCE_START_S) / IMPATIENCE_RAMP_S) * (1 - personality.patience * 0.5);
  const offenseBoost = 1 + impatience * 1.5;
  const passiveDamp = 1 - impatience * 0.5;

  const scores = new Map<AiIntent, number>();

  scores.set(
    AiIntent.PressAdvantage,
    (risk.opportunity + risk.edgePressureOpportunity * (0.4 + personality.aggression * 0.4)) *
      (0.5 + personality.aggression * 0.5) *
      clashWillingness *
      (inCircularRange || inDashRange ? 1 : 0.3),
  );

  scores.set(
    AiIntent.AttackCircular,
    inCircularRange && !alreadyAttacking ? (0.4 + personality.aggression * 0.4 - personality.caution * 0.2) * clashWillingness * offenseBoost : 0,
  );

  scores.set(
    AiIntent.AttackDash,
    inDashRange && !alreadyAttacking && world.own.attackEnergyFraction > 0.25
      ? (0.3 + personality.aggression * 0.5 - personality.patience * 0.2) *
          clashWillingness *
          (1 - resourceConservation * 0.6) *
          (1 - collisionReluctance * 0.7) *
          offenseBoost
      : 0,
  );

  const tooClose = world.distanceToOpponentM < personality.preferredEngageRangeM * 0.6;
  const tooFar = world.distanceToOpponentM > personality.preferredEngageRangeM * 1.6;

  scores.set(
    AiIntent.Approach,
    (tooFar ? 0.6 : 0.2) *
      (0.4 + personality.aggression * 0.6) *
      (1 + risk.edgePressureOpportunity * 0.5) *
      (1 - risk.selfVulnerability * 0.5) *
      (1 - resourceConservation * 0.4) *
      (1 - collisionReluctance * 0.4) *
      offenseBoost,
  );

  scores.set(
    AiIntent.Retreat,
    (tooClose ? 0.55 : 0.15) * (0.3 + personality.caution * 0.7) * (0.4 + risk.selfVulnerability * 0.6 + resourceConservation * 0.3),
  );

  scores.set(
    AiIntent.Circle,
    ((!tooClose && !tooFar ? 0.35 + personality.patience * 0.3 + resourceConservation * 0.2 : 0.1) + collisionReluctance * 0.15) * passiveDamp,
  );

  // GDD section 64 Defense "uses wall/arena positioning": between
  // exchanges, drift back toward the middle (RecoverFromEdge moves toward
  // the center) once outside CENTER_CONTROL_START_FRACTION of the ring —
  // the edge-risk override above still handles real danger on its own.
  const ownRadiusFraction = clamp01(1 - world.own.distanceToEdgeM / RINGOUT_RADIUS_M);
  scores.set(
    AiIntent.RecoverFromEdge,
    alreadyAttacking ? 0 : personality.centerControl * clamp01((ownRadiusFraction - CENTER_CONTROL_START_FRACTION) / (1 - CENTER_CONTROL_START_FRACTION)) * 0.9,
  );

  scores.set(AiIntent.Wait, alreadyAttacking ? 0 : (personality.patience * 0.15 + resourceConservation * 0.15) * passiveDamp);

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

  // Stable order (score desc, then Map insertion order) so the debug view
  // and telemetry are deterministic.
  const ranked = [...scores.entries()].map(([intent, score]) => ({ intent, score })).sort((a, b) => b.score - a.score);
  const reason =
    bestIntent === AiIntent.RecoverFromEdge
      ? `reclaiming the center (score ${clamp01(bestScore).toFixed(2)})`
      : `best score ${clamp01(bestScore).toFixed(2)} among ${scores.size} candidates`;
  return { intent: bestIntent, reason, scores: ranked };
}
