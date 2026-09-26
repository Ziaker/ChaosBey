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
import { AiIntent } from './Intent';
import type { RiskAssessment } from './RiskEvaluation';
import type { WorldState } from './WorldState';

/** Above this edgeRisk, recovering toward the center overrides normal intent scoring entirely (GDD section 129). */
const EDGE_RISK_OVERRIDE_THRESHOLD = 0.55;
/** Above this opponentThreat, answering the imminent hitbox overrides normal scoring — with WHICH answer (dodge, jump, or plain spacing) depending on what's actually available right now, never blindly picking dodge regardless of its cooldown. */
const THREAT_OVERRIDE_THRESHOLD = 0.35;

export interface IntentDecision {
  intent: AiIntent;
  /** Short human-readable justification — GDD section 65's "why a dodge/jump was chosen" debug requirement. */
  reason: string;
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
    if (world.own.dodgeState === DodgeState.Idle) {
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
    inCircularRange && !alreadyAttacking ? (0.4 + personality.aggression * 0.4 - personality.caution * 0.2) * clashWillingness : 0,
  );

  scores.set(
    AiIntent.AttackDash,
    inDashRange && !alreadyAttacking && world.own.attackEnergyFraction > 0.25
      ? (0.3 + personality.aggression * 0.5 - personality.patience * 0.2) * clashWillingness * (1 - resourceConservation * 0.6)
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
      (1 - resourceConservation * 0.4),
  );

  scores.set(
    AiIntent.Retreat,
    (tooClose ? 0.55 : 0.15) * (0.3 + personality.caution * 0.7) * (0.4 + risk.selfVulnerability * 0.6 + resourceConservation * 0.3),
  );

  scores.set(AiIntent.Circle, !tooClose && !tooFar ? 0.35 + personality.patience * 0.3 + resourceConservation * 0.2 : 0.1);

  scores.set(AiIntent.Wait, alreadyAttacking ? 0 : personality.patience * 0.15 + resourceConservation * 0.15);

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

  return { intent: bestIntent, reason: `best score ${clamp01(bestScore).toFixed(2)} among ${scores.size} candidates` };
}
