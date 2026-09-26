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
import { AI_CIRCULAR_ATTACK_RANGE_M, AI_COUNTER_MIN_CLOSING_SPEED_MPS, AI_DEFAULT_DASH_REACH_M } from './AiCombatRanges';
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
  /** True while the opponent is stuck in an attack's recovery (a whiffed/spent Dash or Circular) — a visible punish window (GDD section 106: whiff punishment emerges from recovery time), not a hidden debuff. */
  punishWindow: boolean;
  /** 0..1: how close the opponent is to the ring-out boundary (1 = pinned against the wall) — unweighted by this AI's personality (GDD section 63/129: exploit opponents near the edge). */
  edgePressure: number;
  /**
   * A hit that can land within moments, not a telegraph: a live/just-pressed
   * Circular in reach, or an active Dash closing in within
   * IMMEDIATE_DASH_THREAT_HORIZON_S. A charging Dash never counts — near
   * the edge, the right answer to a telegraph is to get away from the edge,
   * not to spend a dodge early.
   */
  immediateThreat: boolean;
}

/** An active Dash counts as an immediate threat when it can reach this AI within this many seconds. */
const IMMEDIATE_DASH_THREAT_HORIZON_S = 0.4;
/** A live or just-pressed Circular counts as immediate within Circular range plus this margin (m). */
const IMMEDIATE_CIRCULAR_MARGIN_M = 0.5;

function isImmediateThreat(world: WorldState): boolean {
  switch (world.opponent.attackState) {
    case AttackState.Buffering:
    case AttackState.CircularActive:
      return world.distanceToOpponentM <= AI_CIRCULAR_ATTACK_RANGE_M + IMMEDIATE_CIRCULAR_MARGIN_M;
    case AttackState.DashActive: {
      if (world.closingSpeedMps < AI_COUNTER_MIN_CLOSING_SPEED_MPS) return world.distanceToOpponentM <= AI_DEFAULT_DASH_REACH_M + IMMEDIATE_CIRCULAR_MARGIN_M;
      return (world.distanceToOpponentM - AI_DEFAULT_DASH_REACH_M) / world.closingSpeedMps <= IMMEDIATE_DASH_THREAT_HORIZON_S;
    }
    default:
      return false;
  }
}

/**
 * Opponent edge risk at which edge pressure reads as maximal. The arena
 * wall keeps a grounded Bey's center ~1.5 m inside the ring-out line, so an
 * opponent pinned against the wall only reads ~0.55 edge risk — scaling by
 * this keeps "against the wall" meaning "full pressure".
 */
const EDGE_PRESSURE_FULL_AT_OPPONENT_EDGE_RISK = 0.5;

/** Opponent attack states that leave them exposed with no live hitbox (see punishWindow). */
const RECOVERY_ATTACK_STATES: ReadonlySet<AttackState> = new Set([AttackState.DashRecovery, AttackState.CircularRecovery]);

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

  const punishWindow = RECOVERY_ATTACK_STATES.has(world.opponent.attackState);
  const edgePressure = clamp01(world.opponent.edgeRiskFraction / EDGE_PRESSURE_FULL_AT_OPPONENT_EDGE_RISK);

  return { edgeRisk, opponentThreat, selfVulnerability, opportunity, punishWindow, edgePressure, immediateThreat: isImmediateThreat(world) };
}
