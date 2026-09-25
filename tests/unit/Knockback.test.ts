import { describe, expect, it } from 'vitest';
import { computeKnockback } from '../../src/combat/knockback/Knockback';

describe('computeKnockback', () => {
  it('approved rule: a slower defender is more vulnerable to knockback', () => {
    const slow = computeKnockback({
      baseForce: 10,
      attackerSpeedMps: 5,
      defenderSpeedMps: 0,
      defenderStabilityFraction: 1,
      defenderStaminaPenaltyFraction: 0,
    });
    const fast = computeKnockback({
      baseForce: 10,
      attackerSpeedMps: 5,
      defenderSpeedMps: 10,
      defenderStabilityFraction: 1,
      defenderStaminaPenaltyFraction: 0,
    });

    expect(slow.force).toBeGreaterThan(fast.force);
  });

  it('is bounded near zero defender speed (no singularity)', () => {
    const atZero = computeKnockback({
      baseForce: 10,
      attackerSpeedMps: 5,
      defenderSpeedMps: 0,
      defenderStabilityFraction: 1,
      defenderStaminaPenaltyFraction: 0,
    });
    const tiny = computeKnockback({
      baseForce: 10,
      attackerSpeedMps: 5,
      defenderSpeedMps: 0.0001,
      defenderStabilityFraction: 1,
      defenderStaminaPenaltyFraction: 0,
    });

    expect(Number.isFinite(atZero.force)).toBe(true);
    expect(Number.isFinite(tiny.force)).toBe(true);
    // A near-zero defender speed must not produce a wildly different
    // result from exactly-zero — no division blowing up near the origin.
    expect(Math.abs(atZero.force - tiny.force)).toBeLessThan(0.01);
  });

  it('higher defender Stability reduces knockback force', () => {
    const lowStability = computeKnockback({
      baseForce: 10,
      attackerSpeedMps: 5,
      defenderSpeedMps: 3,
      defenderStabilityFraction: 0,
      defenderStaminaPenaltyFraction: 0,
    });
    const fullStability = computeKnockback({
      baseForce: 10,
      attackerSpeedMps: 5,
      defenderSpeedMps: 3,
      defenderStabilityFraction: 1,
      defenderStaminaPenaltyFraction: 0,
    });

    expect(fullStability.force).toBeLessThan(lowStability.force);
  });

  it('low defender Stamina increases knockback vulnerability', () => {
    const fullStamina = computeKnockback({
      baseForce: 10,
      attackerSpeedMps: 5,
      defenderSpeedMps: 3,
      defenderStabilityFraction: 0.5,
      defenderStaminaPenaltyFraction: 0,
    });
    const noStamina = computeKnockback({
      baseForce: 10,
      attackerSpeedMps: 5,
      defenderSpeedMps: 3,
      defenderStabilityFraction: 0.5,
      defenderStaminaPenaltyFraction: 1,
    });

    expect(noStamina.force).toBeGreaterThan(fullStamina.force);
  });

  it('faster attacker speed increases knockback force', () => {
    const slowAttacker = computeKnockback({
      baseForce: 10,
      attackerSpeedMps: 0,
      defenderSpeedMps: 3,
      defenderStabilityFraction: 0.5,
      defenderStaminaPenaltyFraction: 0,
    });
    const fastAttacker = computeKnockback({
      baseForce: 10,
      attackerSpeedMps: 11,
      defenderSpeedMps: 3,
      defenderStabilityFraction: 0.5,
      defenderStaminaPenaltyFraction: 0,
    });

    expect(fastAttacker.force).toBeGreaterThan(slowAttacker.force);
  });
});
