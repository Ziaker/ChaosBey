// ============================================================
// CLASH POWER FORMULA SELF-TESTS
// ============================================================

import { describe, expect, it } from 'vitest';
import {
  computeClashPower,
  computeMashPerformance,
  computeStaminaFactor,
  computeVelocityFactor,
} from '../../src/combat/clash/ClashFormula';
import {
  CLASH_MASH_REFERENCE_EVENT_COUNT,
  CLASH_STAMINA_FACTOR_MAX,
  CLASH_STAMINA_FACTOR_MIN,
  CLASH_VELOCITY_FACTOR_MAX,
  CLASH_VELOCITY_FACTOR_MIN,
  CLASH_VELOCITY_REFERENCE_MPS,
} from '../../src/combat/clash/ClashTuning';

describe('computeMashPerformance', () => {
  it('is 0 at zero mash events and saturates at 1 at/above the reference count', () => {
    expect(computeMashPerformance(0)).toBe(0);
    expect(computeMashPerformance(CLASH_MASH_REFERENCE_EVENT_COUNT)).toBe(1);
    expect(computeMashPerformance(CLASH_MASH_REFERENCE_EVENT_COUNT * 10)).toBe(1);
  });

  it('is monotonically increasing below the reference count', () => {
    expect(computeMashPerformance(2)).toBeLessThan(computeMashPerformance(5));
  });
});

describe('computeStaminaFactor — Stamina contributes to ClashPower', () => {
  it('maps 0..1 Stamina fraction to the capped factor range, never zeroing a combatant out', () => {
    expect(computeStaminaFactor(0)).toBeCloseTo(CLASH_STAMINA_FACTOR_MIN, 5);
    expect(computeStaminaFactor(1)).toBeCloseTo(CLASH_STAMINA_FACTOR_MAX, 5);
    expect(computeStaminaFactor(0)).toBeGreaterThan(0);
  });

  it('higher Stamina produces a higher ClashPower, all else equal', () => {
    const lowStaminaPower = computeClashPower(10, 0.1, 8);
    const highStaminaPower = computeClashPower(10, 0.9, 8);
    expect(highStaminaPower).toBeGreaterThan(lowStaminaPower);
  });
});

describe('computeVelocityFactor — Velocity contributes to ClashPower', () => {
  it('maps speed to the capped factor range, saturating at/above the reference speed', () => {
    expect(computeVelocityFactor(0)).toBeCloseTo(CLASH_VELOCITY_FACTOR_MIN, 5);
    expect(computeVelocityFactor(CLASH_VELOCITY_REFERENCE_MPS)).toBeCloseTo(CLASH_VELOCITY_FACTOR_MAX, 5);
    expect(computeVelocityFactor(CLASH_VELOCITY_REFERENCE_MPS * 5)).toBeCloseTo(CLASH_VELOCITY_FACTOR_MAX, 5);
  });

  it('higher speed produces a higher ClashPower, all else equal', () => {
    const slowPower = computeClashPower(10, 0.5, 1);
    const fastPower = computeClashPower(10, 0.5, CLASH_VELOCITY_REFERENCE_MPS);
    expect(fastPower).toBeGreaterThan(slowPower);
  });
});

describe('computeClashPower', () => {
  it('is the product of the three factors', () => {
    const mashEventCount = 10;
    const staminaFraction = 0.7;
    const speedMps = 6;
    const expected = computeMashPerformance(mashEventCount) * computeStaminaFactor(staminaFraction) * computeVelocityFactor(speedMps);
    expect(computeClashPower(mashEventCount, staminaFraction, speedMps)).toBeCloseTo(expected, 10);
  });

  it('takes exactly (mashEventCount, staminaFraction, speedMps) — no Attack stat, no collision angle parameter', () => {
    // A regression guard: the GDD explicitly scopes the Clash formula to
    // Mash x Stamina x Velocity only (unlike normal Knockback, which does
    // use both Attack and collision angle) — this fails loudly if a 4th
    // parameter is ever silently added.
    expect(computeClashPower.length).toBe(3);
  });
});
