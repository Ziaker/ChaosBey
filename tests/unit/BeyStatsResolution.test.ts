import { describe, expect, it } from 'vitest';
import { resolveBeyStats, RATING_MAX, RATING_MIN, RATING_NEUTRAL_POINT, STAT_MULTIPLIER_PER_RATING_POINT } from '../../src/bey/archetype/BeyStatsResolution';
import { NEUTRAL_BEY_RATINGS } from '../../src/bey/archetype/BeyRatings';

// GDD section 6/31: the approved player-facing scale is bounded 1-10 —
// resolveBeyStats() is the one explicit place that bound is enforced, so a
// bad rating can never turn into an arbitrary/negative internal multiplier.

describe('resolveBeyStats — neutral and in-range ratings', () => {
  it('resolves NEUTRAL_BEY_RATINGS (5/5/5) to exactly neutral (1.0) stats', () => {
    expect(resolveBeyStats(NEUTRAL_BEY_RATINGS)).toEqual({ attack: 1, defense: 1, stamina: 1 });
  });

  it('resolves the minimum rating (1) to the lowest multiplier', () => {
    const stats = resolveBeyStats({ attack: RATING_MIN, defense: 5, stamina: 5 });
    expect(stats.attack).toBeCloseTo(1 + (RATING_MIN - RATING_NEUTRAL_POINT) * STAT_MULTIPLIER_PER_RATING_POINT);
  });

  it('resolves the maximum rating (10) to the highest multiplier', () => {
    const stats = resolveBeyStats({ attack: RATING_MAX, defense: 5, stamina: 5 });
    expect(stats.attack).toBeCloseTo(1 + (RATING_MAX - RATING_NEUTRAL_POINT) * STAT_MULTIPLIER_PER_RATING_POINT);
  });
});

describe('resolveBeyStats — out-of-range ratings are clamped, never propagated', () => {
  it('a rating below 1 clamps to the same result as exactly 1', () => {
    const below = resolveBeyStats({ attack: 0, defense: 5, stamina: 5 });
    const atMin = resolveBeyStats({ attack: RATING_MIN, defense: 5, stamina: 5 });
    expect(below.attack).toBe(atMin.attack);

    const wayBelow = resolveBeyStats({ attack: -50, defense: 5, stamina: 5 });
    expect(wayBelow.attack).toBe(atMin.attack);
  });

  it('a rating above 10 clamps to the same result as exactly 10', () => {
    const above = resolveBeyStats({ attack: 11, defense: 5, stamina: 5 });
    const atMax = resolveBeyStats({ attack: RATING_MAX, defense: 5, stamina: 5 });
    expect(above.attack).toBe(atMax.attack);

    const wayAbove = resolveBeyStats({ attack: 500, defense: 5, stamina: 5 });
    expect(wayAbove.attack).toBe(atMax.attack);
  });

  it('every resolved multiplier stays positive across the full valid range', () => {
    for (let rating = RATING_MIN; rating <= RATING_MAX; rating++) {
      const stats = resolveBeyStats({ attack: rating, defense: rating, stamina: rating });
      expect(stats.attack).toBeGreaterThan(0);
      expect(stats.defense).toBeGreaterThan(0);
      expect(stats.stamina).toBeGreaterThan(0);
    }
  });
});

describe('resolveBeyStats — non-finite ratings fall back to neutral instead of propagating', () => {
  it('NaN falls back to the neutral (1.0) multiplier', () => {
    const stats = resolveBeyStats({ attack: Number.NaN, defense: 5, stamina: 5 });
    expect(stats.attack).toBe(1);
    expect(Number.isFinite(stats.attack)).toBe(true);
  });

  it('+Infinity falls back to the neutral (1.0) multiplier', () => {
    const stats = resolveBeyStats({ attack: Number.POSITIVE_INFINITY, defense: 5, stamina: 5 });
    expect(stats.attack).toBe(1);
  });

  it('-Infinity falls back to the neutral (1.0) multiplier', () => {
    const stats = resolveBeyStats({ attack: Number.NEGATIVE_INFINITY, defense: 5, stamina: 5 });
    expect(stats.attack).toBe(1);
  });
});
