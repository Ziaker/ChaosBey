// ============================================================
// AI RISK EVALUATION (MILESTONE 7)
// GDD section 62: layer 3. Pure scoring functions over a WorldState — no
// randomness, no state mutation, fully unit-testable. IntentSelection.ts
// combines these scores with AiPersonality's tendencies to choose an
// intent; this file only measures "how dangerous/promising is the current
// situation", it never itself decides what to do about it.
// ============================================================

import { AttackState } from '../../combat/attacks/AttackController';
import type { AiPersonality } from '../personalities/AiPersonality';
import type { WorldState } from './WorldState';

export interface RiskAssessment {
  /** 0..1, personality-weighted danger of leaving the ring soon (GDD section 129) — from the current position or, if worse, the momentum-projected one. */
  edgeRisk: number;
  /** 0..1: how dangerous the opponent's current/imminent action is to react to right now (an active/imminent hitbox within realistic striking range). */
  opponentThreat: number;
  /** 0..1: how vulnerable this AI's own Bey currently is (low Stability/Stamina, or already Broken — GDD section 28/30: Broken is a visible danger state a decisive hit can end). */
  selfVulnerability: number;
  /**
   * 0..1: how good an opening the opponent is presenting right now — Broken/
   * low Stability (GDD section 64 Attack: "pressures broken Stability") OR
   * caught in an attack's own Recovery window (DashRecovery/
   * CircularRecovery — a real whiff/commitment punish opportunity, not
   * "hittable because weak", weighted by counterAttackBias) OR tired (low
   * Stamina, weighted by fatigueExploitation).
   */
  opportunity: number;
  /**
   * 0..1: how attractive it is to press the opponent right now specifically
   * because THEY are close to the ring boundary (GDD section 63: "AI
   * exploits opponents near the edge") — independent of `opportunity`
   * (Stability/whiff), since an opponent can be at full health and still be
   * one good knockback from a ring-out.
   */
  edgePressureOpportunity: number;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Range (m) inside which an opponent's imminent hitbox is treated as an immediate threat rather than a distant one worth ignoring for now. Wide enough to cover a charging Dash Attack's realistic closing distance, not just point-blank range. */
const THREAT_RANGE_M = 6.5;

/** Opponent Stamina fraction below which their fatigue starts counting as an opening (scaled by AiPersonality.fatigueExploitation), reaching full weight at 0. */
const FATIGUE_OPPORTUNITY_STAMINA_FRACTION = 0.5;

/** Range (m) inside which pressing a boundary-exposed opponent is worth prioritizing — beyond this, closing the distance first is Approach's job, not a special edge-pressure read. */
const EDGE_PRESSURE_RANGE_M = 8;

export function evaluateRisk(world: WorldState, personality: AiPersonality): RiskAssessment {
  // Whichever is worse: where this Bey is, or where its own momentum takes
  // it within EDGE_PROJECTION_HORIZON_S (see AiPerception.ts).
  const edgeRisk = clamp01(Math.max(world.own.edgeRiskFraction, world.own.projectedEdgeRiskFraction) * personality.edgeCautionMultiplier);

  const opponentInRange = clamp01(1 - world.distanceToOpponentM / THREAT_RANGE_M);
  const opponentThreat = world.opponent.hasImminentHitbox ? clamp01(opponentInRange) : 0;

  const stabilityVulnerability = 1 - world.own.stabilityFraction;
  const staminaVulnerability = 1 - world.own.staminaFraction;
  const selfVulnerability = clamp01(
    (world.own.isBroken ? 0.6 : 0) + stabilityVulnerability * 0.3 + staminaVulnerability * 0.1,
  );

  // A defender in Recovery has no active/imminent hitbox and (per
  // AttackController) cannot cancel out of it — a genuinely safe, timed
  // window to punish a committed whiff, distinct from "opponent is just
  // weak right now".
  const opponentInAttackRecovery = world.opponent.attackState === AttackState.DashRecovery || world.opponent.attackState === AttackState.CircularRecovery;
  // How much that window is worth depends on the personality's appetite
  // for counters (GDD section 64 Defense: "punishes commitment") — 0.5 at
  // the neutral counterAttackBias of 0.5, matching the previous flat value.
  const whiffPunishOpportunity = opponentInAttackRecovery ? 0.5 * (0.5 + personality.counterAttackBias) : 0;
  // A tired opponent (low Stamina) is an opening for a personality that
  // exploits fatigue (GDD section 64 Stamina) — nothing above
  // FATIGUE_OPPORTUNITY_STAMINA_FRACTION.
  const opponentFatigue = clamp01((FATIGUE_OPPORTUNITY_STAMINA_FRACTION - world.opponent.staminaFraction) / FATIGUE_OPPORTUNITY_STAMINA_FRACTION);
  const fatigueOpportunity = opponentFatigue * 0.6 * personality.fatigueExploitation;
  const opportunity = clamp01(
    (world.opponent.isBroken ? 0.7 : 0) + (1 - world.opponent.stabilityFraction) * 0.3 + whiffPunishOpportunity + fatigueOpportunity,
  );

  const edgePressureOpportunity = clamp01(
    world.opponent.edgeRiskFraction * (1 - world.distanceToOpponentM / EDGE_PRESSURE_RANGE_M),
  );

  return { edgeRisk, opponentThreat, selfVulnerability, opportunity, edgePressureOpportunity };
}
