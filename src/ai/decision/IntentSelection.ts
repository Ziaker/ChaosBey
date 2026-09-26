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
// unrelated goals like a normal attack decision.
// ============================================================

import { AttackState } from '../../combat/attacks/AttackController';
import { DodgeState } from '../../dodge/DodgeController';
import type { AiPersonality } from '../personalities/AiPersonality';
import { AiIntent } from './Intent';
import type { RiskAssessment } from './RiskEvaluation';
import type { WorldState } from './WorldState';

/** Above this edgeRisk, recovering toward the center overrides normal intent scoring entirely (GDD section 129). */
const EDGE_RISK_OVERRIDE_THRESHOLD = 0.55;
/** Above this opponentThreat, answering with a dodge overrides normal scoring (still subject to IntentionalError.ts's imperfection pass, and to dodgeSkill at the action-selection stage). */
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
  if (risk.edgeRisk >= EDGE_RISK_OVERRIDE_THRESHOLD) {
    return { intent: AiIntent.RecoverFromEdge, reason: `edge risk ${risk.edgeRisk.toFixed(2)} over threshold` };
  }
  if (risk.opponentThreat >= THREAT_OVERRIDE_THRESHOLD) {
    return { intent: AiIntent.DodgeThreat, reason: `opponent threat ${risk.opponentThreat.toFixed(2)} — imminent hitbox in range` };
  }

  // Never try to attack while already mid-attack (Buffering/Charging/Active
  // states resolve on their own timers) — the AI simply keeps whatever
  // ActionSelection.ts derives for holding the attack button, not a fresh
  // intent every tick.
  const alreadyAttacking =
    world.own.attackState !== AttackState.Neutral &&
    world.own.attackState !== AttackState.DashRecovery &&
    world.own.attackState !== AttackState.CircularRecovery;

  const inCircularRange = world.distanceToOpponentM <= 2.2;
  const inDashRange = world.distanceToOpponentM > 2.2 && world.distanceToOpponentM <= 9;

  const scores = new Map<AiIntent, number>();

  scores.set(
    AiIntent.PressAdvantage,
    risk.opportunity * (0.5 + personality.aggression * 0.5) * (inCircularRange || inDashRange ? 1 : 0.3),
  );

  scores.set(
    AiIntent.AttackCircular,
    inCircularRange && !alreadyAttacking ? 0.4 + personality.aggression * 0.4 - personality.caution * 0.2 : 0,
  );

  scores.set(
    AiIntent.AttackDash,
    inDashRange && !alreadyAttacking && world.own.attackEnergyFraction > 0.25
      ? 0.3 + personality.aggression * 0.5 - personality.patience * 0.2
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

  scores.set(AiIntent.Circle, !tooClose && !tooFar ? 0.35 + personality.patience * 0.3 : 0.1);

  scores.set(AiIntent.Wait, alreadyAttacking ? 0 : personality.patience * 0.15);

  // Dodge is on cooldown but the opponent still looks dangerous — a jump
  // is the only other evasive option left (GDD section 20: "a jump can
  // count as an evasive action when it causes an attack to miss").
  scores.set(
    AiIntent.UseJumpDrift,
    world.opponent.hasImminentHitbox && world.own.dodgeState === DodgeState.Cooldown && risk.opponentThreat > 0.3 ? 0.5 : 0.05,
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
