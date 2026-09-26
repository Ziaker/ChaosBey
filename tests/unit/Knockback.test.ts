import { describe, expect, it } from 'vitest';
import { computeKnockback, computeStabilityDamage, type KnockbackInput } from '../../src/combat/knockback/Knockback';

// Stationary attacker / arbitrary impact direction — the collision-angle
// factor is then a fixed neutral midpoint (see the dedicated describe
// block below), so it cancels out of comparisons that hold everything
// else equal and only vary one of the other factors.
const NEUTRAL_ANGLE_INPUT = { attackerVelocityXZ: { x: 0, z: 0 }, impactDirectionXZ: { x: 0, z: 1 } };

function input(overrides: Partial<KnockbackInput> = {}): KnockbackInput {
  return {
    baseForce: 10,
    attackerSpeedMps: 5,
    defenderSpeedMps: 0,
    defenderStabilityFraction: 1,
    defenderStaminaPenaltyFraction: 0,
    attackStat: 1,
    defenseStat: 1,
    ...NEUTRAL_ANGLE_INPUT,
    ...overrides,
  };
}

describe('computeKnockback', () => {
  it('approved rule: a slower defender is more vulnerable to knockback', () => {
    const slow = computeKnockback(input({ defenderSpeedMps: 0 }));
    const fast = computeKnockback(input({ defenderSpeedMps: 10 }));

    expect(slow.force).toBeGreaterThan(fast.force);
  });

  it('is bounded near zero defender speed (no singularity)', () => {
    const atZero = computeKnockback(input({ defenderSpeedMps: 0 }));
    const tiny = computeKnockback(input({ defenderSpeedMps: 0.0001 }));

    expect(Number.isFinite(atZero.force)).toBe(true);
    expect(Number.isFinite(tiny.force)).toBe(true);
    // A near-zero defender speed must not produce a wildly different
    // result from exactly-zero — no division blowing up near the origin.
    expect(Math.abs(atZero.force - tiny.force)).toBeLessThan(0.01);
  });

  it('higher defender Stability reduces knockback force', () => {
    const lowStability = computeKnockback(input({ defenderSpeedMps: 3, defenderStabilityFraction: 0 }));
    const fullStability = computeKnockback(input({ defenderSpeedMps: 3, defenderStabilityFraction: 1 }));

    expect(fullStability.force).toBeLessThan(lowStability.force);
  });

  it('low defender Stamina increases knockback vulnerability', () => {
    const fullStamina = computeKnockback(input({ defenderSpeedMps: 3, defenderStabilityFraction: 0.5, defenderStaminaPenaltyFraction: 0 }));
    const noStamina = computeKnockback(input({ defenderSpeedMps: 3, defenderStabilityFraction: 0.5, defenderStaminaPenaltyFraction: 1 }));

    expect(noStamina.force).toBeGreaterThan(fullStamina.force);
  });

  it('faster attacker speed increases knockback force', () => {
    const slowAttacker = computeKnockback(input({ attackerSpeedMps: 0, defenderSpeedMps: 3, defenderStabilityFraction: 0.5 }));
    const fastAttacker = computeKnockback(input({ attackerSpeedMps: 11, defenderSpeedMps: 3, defenderStabilityFraction: 0.5 }));

    expect(fastAttacker.force).toBeGreaterThan(slowAttacker.force);
  });
});

describe('computeKnockback collision angle factor (GDD section 27)', () => {
  it('a head-on hit (attacker moving straight into the impact direction) produces more force than a glancing/perpendicular one', () => {
    const headOn = computeKnockback(
      input({ attackerVelocityXZ: { x: 0, z: 1 }, impactDirectionXZ: { x: 0, z: 1 } }),
    );
    const glancing = computeKnockback(
      input({ attackerVelocityXZ: { x: 1, z: 0 }, impactDirectionXZ: { x: 0, z: 1 } }),
    );

    expect(headOn.force).toBeGreaterThan(glancing.force);
  });

  it('a hit while the attacker moves away from the defender produces less force than a head-on hit, but stays bounded/finite', () => {
    const headOn = computeKnockback(
      input({ attackerVelocityXZ: { x: 0, z: 1 }, impactDirectionXZ: { x: 0, z: 1 } }),
    );
    const movingAway = computeKnockback(
      input({ attackerVelocityXZ: { x: 0, z: -1 }, impactDirectionXZ: { x: 0, z: 1 } }),
    );

    expect(Number.isFinite(movingAway.force)).toBe(true);
    expect(movingAway.force).toBeLessThan(headOn.force);
    expect(movingAway.force).toBeGreaterThan(0);
  });

  it('a stationary attacker (no defined direction) produces a well-defined, finite force with no singularity', () => {
    const result = computeKnockback(input({ attackerVelocityXZ: { x: 0, z: 0 } }));

    expect(Number.isFinite(result.force)).toBe(true);
    expect(result.force).toBeGreaterThan(0);
  });
});

describe('computeKnockback archetype Attack/Defense stats (Milestone 6, GDD section 6/31)', () => {
  it('is unchanged from pre-Milestone-6 behavior at neutral (1.0) stats', () => {
    const neutral = computeKnockback(input({ attackStat: 1, defenseStat: 1 }));
    const explicitNeutral = computeKnockback(input({}));

    expect(neutral.force).toBe(explicitNeutral.force);
  });

  it('a higher attacker Attack stat increases knockback force', () => {
    const base = computeKnockback(input({ attackStat: 1 }));
    const boosted = computeKnockback(input({ attackStat: 1.3 }));

    expect(boosted.force).toBeGreaterThan(base.force);
  });

  it('a higher defender Defense stat reduces knockback force', () => {
    const base = computeKnockback(input({ defenseStat: 1 }));
    const defended = computeKnockback(input({ defenseStat: 1.3 }));

    expect(defended.force).toBeLessThan(base.force);
  });
});

describe('computeStabilityDamage archetype Attack/Defense stats (Milestone 6, GDD section 6/31)', () => {
  it('is a passthrough at neutral (1.0) Attack/Defense', () => {
    expect(computeStabilityDamage(10, 1, 1)).toBe(10);
  });

  it('a higher attacker Attack stat increases Stability damage dealt', () => {
    expect(computeStabilityDamage(10, 1.3, 1)).toBeGreaterThan(computeStabilityDamage(10, 1, 1));
  });

  it('a higher defender Defense stat reduces Stability damage taken', () => {
    expect(computeStabilityDamage(10, 1, 1.3)).toBeLessThan(computeStabilityDamage(10, 1, 1));
  });
});
