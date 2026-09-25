// ============================================================
// IMPACT MAGNITUDE SELF-TESTS
// Verifies the owner-approved "Hybrid scalable" (profile C) escalation
// curve: small/routine values stay well below a linear mapping, values at
// or above the reference max saturate at 1, and event kinds that are
// always meant to read as a genuine moment (KO, ring-out, Stability
// Break, Perfect Dodge) carry a fixed floor regardless of the exact
// numbers that caused them.
// ============================================================

import { describe, expect, it } from 'vitest';
import {
  DODGED_MAGNITUDE,
  KO_MAGNITUDE,
  PERFECT_DODGE_MAGNITUDE,
  RING_OUT_MAGNITUDE,
  STABILITY_BREAK_MAGNITUDE,
  knockbackMagnitude,
  landingMagnitude,
  movementImpactMagnitude,
} from '../../src/camera/ImpactMagnitude';

describe('knockbackMagnitude', () => {
  it('is 0 for zero force and saturates at 1 well beyond the reference max', () => {
    expect(knockbackMagnitude(0)).toBe(0);
    expect(knockbackMagnitude(1000)).toBe(1);
  });

  it('is monotonically increasing with force', () => {
    expect(knockbackMagnitude(10)).toBeLessThan(knockbackMagnitude(20));
    expect(knockbackMagnitude(20)).toBeLessThan(knockbackMagnitude(30));
  });

  it('ease-in curve: a small/routine force reads well below a linear mapping (profile C — small hits stay clean)', () => {
    // A modest Circular-Attack-sized force (~6, see AttackTuning) should
    // read as much less than "6/reference" would under a straight line —
    // the whole point of the ease-in exponent.
    const linearApprox = 6 / 35; // ImpactMagnitude's own reference constant, duplicated here only as an upper bound check.
    expect(knockbackMagnitude(6)).toBeLessThan(linearApprox);
  });
});

describe('landingMagnitude', () => {
  it('maps 0..1 to 0..1, ease-in shaped (a weak landing stays subtle)', () => {
    expect(landingMagnitude(0)).toBe(0);
    expect(landingMagnitude(1)).toBe(1);
    expect(landingMagnitude(0.3)).toBeLessThan(0.3);
    expect(landingMagnitude(0.3)).toBeGreaterThan(0);
  });
});

describe('movementImpactMagnitude', () => {
  it('is 0 at zero speed delta and saturates at 1 well beyond the reference max', () => {
    expect(movementImpactMagnitude(0)).toBe(0);
    expect(movementImpactMagnitude(100)).toBe(1);
  });

  it('is monotonically increasing', () => {
    expect(movementImpactMagnitude(2)).toBeLessThan(movementImpactMagnitude(5));
    expect(movementImpactMagnitude(5)).toBeLessThan(movementImpactMagnitude(9));
  });
});

describe('fixed-floor event magnitudes', () => {
  it('are all within (0, 1], with KO as the single largest moment', () => {
    for (const value of [STABILITY_BREAK_MAGNITUDE, KO_MAGNITUDE, RING_OUT_MAGNITUDE, PERFECT_DODGE_MAGNITUDE, DODGED_MAGNITUDE]) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(KO_MAGNITUDE).toBeGreaterThanOrEqual(RING_OUT_MAGNITUDE);
    expect(RING_OUT_MAGNITUDE).toBeGreaterThan(STABILITY_BREAK_MAGNITUDE);
    expect(STABILITY_BREAK_MAGNITUDE).toBeGreaterThan(PERFECT_DODGE_MAGNITUDE);
    expect(PERFECT_DODGE_MAGNITUDE).toBeGreaterThan(DODGED_MAGNITUDE);
  });
});
