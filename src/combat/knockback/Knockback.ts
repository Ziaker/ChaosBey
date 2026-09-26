// ============================================================
// KNOCKBACK
// Pure formula (testable without physics) plus a thin apply step that
// turns the result into an impulse on the defender's rigid body. See
// KnockbackTuning.ts for the GDD section 27/126 rationale.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import { dot, normalize, scale, subtract, type Vec2 } from '../../physics/Vec2';
import { INTENDED_MAX_SPEED_MPS } from '../../bey/movement/MovementTuning';
import {
  ATTACKER_SPEED_KNOCKBACK_WEIGHT,
  COLLISION_ANGLE_MAX_FACTOR,
  COLLISION_ANGLE_MIN_FACTOR,
  DEFENDER_MAX_VULNERABILITY_AT_ZERO_SPEED,
  DEFENDER_MIN_VULNERABILITY_AT_REFERENCE_SPEED,
  DEFENDER_VULNERABILITY_REFERENCE_SPEED_MPS,
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
  /** Attacker's archetype Attack stat (BeyStats.attack) — 1 = neutral. Multiplies force directly. */
  attackStat: number;
  /** Defender's archetype Defense stat (BeyStats.defense) — 1 = neutral. Divides force (higher Defense means less taken). */
  defenseStat: number;
  /** Attacker's horizontal velocity at the moment of the hit — used only for the collision-angle factor below; a zero/near-zero vector (stationary attacker) is handled safely. */
  attackerVelocityXZ: Vec2;
  /** Unit-ish vector from attacker to defender at the moment of the hit (need not be pre-normalized). */
  impactDirectionXZ: Vec2;
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

  // -1 (attacker moving straight away from/across the hit) .. 1 (attacker
  // moving straight into it); 0 (the lerp midpoint) for a stationary
  // attacker, since normalize() safely returns the zero vector rather than
  // dividing by ~0.
  const attackerDirection = normalize(input.attackerVelocityXZ);
  const impactDirection = normalize(input.impactDirectionXZ);
  const alignment = dot(attackerDirection, impactDirection);
  const angleFactor = lerp(COLLISION_ANGLE_MIN_FACTOR, COLLISION_ANGLE_MAX_FACTOR, (alignment + 1) / 2);

  const force =
    (input.baseForce * input.attackStat / input.defenseStat) *
    attackerSpeedFactor *
    defenderVulnerability *
    stabilityReduction *
    staminaVulnerability *
    angleFactor;

  const impulseMagnitude = force * KNOCKBACK_IMPULSE_PER_FORCE_UNIT;
  return {
    force,
    impulseMagnitude,
    upwardImpulseMagnitude: impulseMagnitude * KNOCKBACK_UPWARD_LAUNCH_FRACTION,
  };
}

/** defenseStat: defender's archetype Defense stat (BeyStats.defense) — 1 = neutral, higher takes less Stability damage (GDD section 31). */
export function computeStabilityDamage(baseDamage: number, defenseStat: number): number {
  return baseDamage / defenseStat;
}

/** Applies a horizontal + upward knockback impulse to the defender, directed away from the attacker. */
export function applyKnockback(defenderBody: RAPIER.RigidBody, attackerPositionXZ: Vec2, defenderPositionXZ: Vec2, result: KnockbackResult): void {
  const direction = normalize(subtract(defenderPositionXZ, attackerPositionXZ));
  const horizontalImpulse = scale(direction, result.impulseMagnitude);
  defenderBody.applyImpulse({ x: horizontalImpulse.x, y: result.upwardImpulseMagnitude, z: horizontalImpulse.z }, true);
}
