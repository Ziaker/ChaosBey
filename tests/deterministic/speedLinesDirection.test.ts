// ============================================================
// SPEED LINES DIRECTION SELF-TESTS
// Pure-function tests (no THREE.js/renderer needed) for the GDD
// requirement that speed-line streaks track the real, camera-relative
// direction of travel rather than sitting as a fixed radial overlay.
// ============================================================

import { describe, expect, it } from 'vitest';
import {
  computeSpeedLineAngleRad,
  computeSpeedLineBaseAngleRad,
  computeSpeedLinesOpacityFraction,
} from '../../src/vfx/SpeedLinesVfx';
import { SPEED_LINES_FULL_OPACITY_SPEED_MPS, SPEED_LINES_THRESHOLD_MPS } from '../../src/vfx/VfxTuning';

describe('computeSpeedLineBaseAngleRad', () => {
  it('different travel directions produce different (opposite-facing) base angles', () => {
    const forward = computeSpeedLineBaseAngleRad({ x: 0, z: 1 }, 0);
    const right = computeSpeedLineBaseAngleRad({ x: 1, z: 0 }, 0);
    const backward = computeSpeedLineBaseAngleRad({ x: 0, z: -1 }, 0);

    // All distinct — direction genuinely changes the result.
    expect(forward).not.toBeCloseTo(right, 3);
    expect(forward).not.toBeCloseTo(backward, 3);

    // Streaks stream backward from the direction of travel: moving
    // forward (+z) should point the streak base angle roughly opposite
    // (i.e. differ from moving backward (-z) by ~π).
    const delta = Math.atan2(Math.sin(forward - backward), Math.cos(forward - backward));
    expect(Math.abs(delta)).toBeCloseTo(Math.PI, 1);
  });

  it('keeps the previous angle when the direction is negligible, instead of snapping to an arbitrary one', () => {
    const previous = 1.234;
    expect(computeSpeedLineBaseAngleRad({ x: 0, z: 0 }, previous)).toBe(previous);
    expect(computeSpeedLineBaseAngleRad({ x: 0.001, z: 0.001 }, previous)).toBe(previous);
  });

  it('a real direction overrides the previous angle', () => {
    const previous = 0;
    const result = computeSpeedLineBaseAngleRad({ x: 1, z: 0 }, previous);
    expect(result).not.toBe(previous);
  });
});

describe('computeSpeedLineAngleRad', () => {
  it('spreads lines symmetrically across the arc, centered on the base angle', () => {
    const base = 0.5;
    const arc = Math.PI / 2;
    const count = 5;

    const first = computeSpeedLineAngleRad(base, 0, count, arc);
    const last = computeSpeedLineAngleRad(base, count - 1, count, arc);
    const middle = computeSpeedLineAngleRad(base, 2, count, arc);

    expect(first).toBeCloseTo(base - arc / 2, 5);
    expect(last).toBeCloseTo(base + arc / 2, 5);
    expect(middle).toBeCloseTo(base, 5);
  });

  it('a single line sits exactly on the base angle', () => {
    expect(computeSpeedLineAngleRad(0.7, 0, 1, Math.PI / 2)).toBeCloseTo(0.7, 5);
  });
});

describe('computeSpeedLinesOpacityFraction', () => {
  it('hides the lines (0) at or below the threshold speed', () => {
    expect(computeSpeedLinesOpacityFraction(0)).toBe(0);
    expect(computeSpeedLinesOpacityFraction(SPEED_LINES_THRESHOLD_MPS)).toBe(0);
  });

  it('reaches full (1) at or above the full-opacity reference speed', () => {
    expect(computeSpeedLinesOpacityFraction(SPEED_LINES_FULL_OPACITY_SPEED_MPS)).toBe(1);
    expect(computeSpeedLinesOpacityFraction(SPEED_LINES_FULL_OPACITY_SPEED_MPS * 5)).toBe(1);
  });

  it('is monotonically increasing between the two references', () => {
    const mid1 = (SPEED_LINES_THRESHOLD_MPS + SPEED_LINES_FULL_OPACITY_SPEED_MPS) / 3;
    const mid2 = (SPEED_LINES_THRESHOLD_MPS + SPEED_LINES_FULL_OPACITY_SPEED_MPS) / 2;
    expect(computeSpeedLinesOpacityFraction(mid1)).toBeLessThan(computeSpeedLinesOpacityFraction(mid2));
  });
});
