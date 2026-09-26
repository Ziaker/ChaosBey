// ============================================================
// AI RISK EVALUATION (MILESTONE 7)
// GDD section 62: layer 3. Pure scoring functions over a WorldState — no
// randomness, no state mutation, fully unit-testable. IntentSelection.ts
// combines these scores with AiPersonality's tendencies to choose an
// intent; this file only measures "how dangerous/promising is the current
// situation", it never itself decides what to do about it.
// ============================================================

import type { AiPersonality } from '../personalities/AiPersonality';
import type { WorldState } from './WorldState';

export interface RiskAssessment {
  /** 0..1, personality-weighted danger of leaving the ring soon (GDD section 129). */
  edgeRisk: number;
  /** 0..1: how dangerous the opponent's current/imminent action is to react to right now (an active/imminent hitbox within realistic striking range). */
  opponentThreat: number;
  /** 0..1: how vulnerable this AI's own Bey currently is (low Stability/Stamina, or already Broken — GDD section 28/30: Broken is a visible danger state a decisive hit can end). */
  selfVulnerability: number;
  /** 0..1: how good an opening the opponent is presenting right now (Broken, low Stability, or caught in an exposed recovery-adjacent state) — GDD section 64 Attack: "pressures broken Stability". */
  opportunity: number;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Range (m) inside which an opponent's imminent hitbox is treated as an immediate threat rather than a distant one worth ignoring for now. Wide enough to cover a charging Dash Attack's realistic closing distance, not just point-blank range. */
const THREAT_RANGE_M = 6.5;

export function evaluateRisk(world: WorldState, personality: AiPersonality): RiskAssessment {
  const edgeRisk = clamp01(world.own.edgeRiskFraction * personality.edgeCautionMultiplier);

  const opponentInRange = clamp01(1 - world.distanceToOpponentM / THREAT_RANGE_M);
  const opponentThreat = world.opponent.hasImminentHitbox ? clamp01(opponentInRange) : 0;

  const stabilityVulnerability = 1 - world.own.stabilityFraction;
  const staminaVulnerability = 1 - world.own.staminaFraction;
  const selfVulnerability = clamp01(
    (world.own.isBroken ? 0.6 : 0) + stabilityVulnerability * 0.3 + staminaVulnerability * 0.1,
  );

  const opportunity = clamp01((world.opponent.isBroken ? 0.7 : 0) + (1 - world.opponent.stabilityFraction) * 0.3);

  return { edgeRisk, opponentThreat, selfVulnerability, opportunity };
}
