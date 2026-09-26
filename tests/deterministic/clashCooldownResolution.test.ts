// ============================================================
// CLASH COOLDOWN ALTERNATIVE RESOLUTION SELF-TESTS
// ============================================================

import { describe, expect, it } from 'vitest';
import { computeCooldownAlternativeMultiplier } from '../../src/combat/clash/ClashCooldownResolution';
import { CLASH_COOLDOWN_ALT_SLOWER_PENALTY_MAX, CLASH_VELOCITY_REFERENCE_MPS } from '../../src/combat/clash/ClashTuning';

describe('computeCooldownAlternativeMultiplier', () => {
  it('is exactly 1 (no penalty) when both combatants are equally fast', () => {
    expect(computeCooldownAlternativeMultiplier(5, 5)).toBeCloseTo(1, 10);
  });

  it('is exactly 1 (no penalty) for the faster combatant, even a lot faster', () => {
    expect(computeCooldownAlternativeMultiplier(10, 2)).toBeCloseTo(1, 10);
  });

  it('the slower combatant gets more than 1x, scaling with the speed gap', () => {
    const smallGap = computeCooldownAlternativeMultiplier(4, 5);
    const bigGap = computeCooldownAlternativeMultiplier(0, 8);
    expect(smallGap).toBeGreaterThan(1);
    expect(bigGap).toBeGreaterThan(smallGap);
  });

  it('saturates at 1 + CLASH_COOLDOWN_ALT_SLOWER_PENALTY_MAX once the gap reaches the reference speed, never exceeding it', () => {
    const atReference = computeCooldownAlternativeMultiplier(0, CLASH_VELOCITY_REFERENCE_MPS);
    const wayBeyond = computeCooldownAlternativeMultiplier(0, CLASH_VELOCITY_REFERENCE_MPS * 5);
    expect(atReference).toBeCloseTo(1 + CLASH_COOLDOWN_ALT_SLOWER_PENALTY_MAX, 10);
    expect(wayBeyond).toBeCloseTo(1 + CLASH_COOLDOWN_ALT_SLOWER_PENALTY_MAX, 10);
  });
});
