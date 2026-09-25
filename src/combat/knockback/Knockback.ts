// ============================================================
// KNOCKBACK
// Pure formula (testable without physics) plus a thin apply step that
// turns the result into an impulse on the defender's rigid body. See
// KnockbackTuning.ts for the GDD section 27/126 rationale.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import { normalize, scale, subtract, type Vec2 } from '../../physics/Vec2';
import { INTENDED_MAX_SPEED_MPS } from '../../bey/movement/MovementTuning';
import {
  ATTACKER_SPEED_KNOCKBACK_WEIGHT,
  ATTACK_STAT_MULTIPLIER_PLACEHOLDER,
  DEFENDER_MAX_VULNERABILITY_AT_ZERO_SPEED,
  DEFENDER_MIN_VULNERABILITY_AT_REFERENCE_SPEED,
  DEFENDER_VULNERABILITY_REFERENCE_SPEED_MPS,
  DEFENSE_STAT_MULTIPLIER_PLACEHOLDER,
  KNOCKBACK_IMPULSE_PER_FORCE_UNIT,
  KNOCKBACK_UPWARD_LAUNCH_FRACTION,
  STABILITY_KNOCKBACK_REDUCTION_AT_FULL,
  STAMINA_MAX_KNOCKBACK_VULNERABILITY_BONUS,
} from './KnockbackTuning';

export interface KnockbackInput {
  baseForce: number;
  attackerSpeedMps: number;
  defenderSpeedMps: number;
  defenderStabilityFraction: number; // 0..1
  defenderStaminaPenaltyFraction: number; // 0 = full stamina, 1 = fully depleted
}

export interface KnockbackResult {
  force: number;
  impulseMagnitude: number;
  upwardImpulseMagnitude: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function computeKnockback(input: KnockbackInput): KnockbackResult {
  const attackerSpeedFactor = 1 + (input.attackerSpeedMps / INTENDED_MAX_SPEED_MPS) * ATTACKER_SPEED_KNOCKBACK_WEIGHT;

  const defenderSpeedFraction = Math.min(1, input.defenderSpeedMps / DEFENDER_VULNERABILITY_REFERENCE_SPEED_MPS);
  const defenderVulnerability = lerp(
    DEFENDER_MAX_VULNERABILITY_AT_ZERO_SPEED,
    DEFENDER_MIN_VULNERABILITY_AT_REFERENCE_SPEED,
    defenderSpeedFraction,
  );

  const stabilityReduction = 1 - input.defenderStabilityFraction * STABILITY_KNOCKBACK_REDUCTION_AT_FULL;
  const staminaVulnerability = 1 + input.defenderStaminaPenaltyFraction * STAMINA_MAX_KNOCKBACK_VULNERABILITY_BONUS;

  const force =
    input.baseForce *
    ATTACK_STAT_MULTIPLIER_PLACEHOLDER *
    DEFENSE_STAT_MULTIPLIER_PLACEHOLDER *
    attackerSpeedFactor *
    defenderVulnerability *
    stabilityReduction *
    staminaVulnerability;

  const impulseMagnitude = force * KNOCKBACK_IMPULSE_PER_FORCE_UNIT;
  return {
    force,
    impulseMagnitude,
    upwardImpulseMagnitude: impulseMagnitude * KNOCKBACK_UPWARD_LAUNCH_FRACTION,
  };
}

/**
 * Defense stat integration is Milestone 6 (archetype balance) — until
 * then DEFENSE_STAT_MULTIPLIER_PLACEHOLDER is 1 and this is a passthrough.
 * STABILITY_DAMAGE_DEFENSE_REDUCTION_AT_FULL is declared now so the real
 * Defense-based reduction drops in later without redesigning this call site.
 */
export function computeStabilityDamage(baseDamage: number): number {
  return baseDamage * DEFENSE_STAT_MULTIPLIER_PLACEHOLDER;
}

/** Applies a horizontal + upward knockback impulse to the defender, directed away from the attacker. */
export function applyKnockback(defenderBody: RAPIER.RigidBody, attackerPositionXZ: Vec2, defenderPositionXZ: Vec2, result: KnockbackResult): void {
  const direction = normalize(subtract(defenderPositionXZ, attackerPositionXZ));
  const horizontalImpulse = scale(direction, result.impulseMagnitude);
  defenderBody.applyImpulse({ x: horizontalImpulse.x, y: result.upwardImpulseMagnitude, z: horizontalImpulse.z }, true);
}
