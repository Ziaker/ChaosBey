// ============================================================
// CLASH WINDOW SELF-TESTS
// ============================================================

import { describe, expect, it } from 'vitest';
import { isWithinClashWindow } from '../../src/combat/clash/ClashWindow';
import { CLASH_WINDOW_S } from '../../src/combat/clash/ClashTuning';

describe('isWithinClashWindow', () => {
  it('attacks outside the 150ms window do not Clash', () => {
    expect(isWithinClashWindow(CLASH_WINDOW_S + 0.01)).toBe(false);
    expect(isWithinClashWindow(0.5)).toBe(false);
  });

  it('attacks within the 150ms window can Clash', () => {
    expect(isWithinClashWindow(0)).toBe(true);
    expect(isWithinClashWindow(0.05)).toBe(true);
    expect(isWithinClashWindow(CLASH_WINDOW_S)).toBe(true); // inclusive boundary.
  });

  it('is symmetric — sign of the delta does not matter', () => {
    expect(isWithinClashWindow(-0.1)).toBe(isWithinClashWindow(0.1));
  });
});
