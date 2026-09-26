// ============================================================
// CLASH CAMERA DIRECTOR SELF-TESTS
// ============================================================

import { describe, expect, it } from 'vitest';
import { ClashCameraDirector } from '../../src/camera/ClashCameraDirector';

const MIDPOINT = { x: 0, y: 0, z: 0 };
const FIXED_DELTA_SECONDS = 1 / 60;

describe('ClashCameraDirector', () => {
  it('always focuses exactly on the given midpoint', () => {
    const director = new ClashCameraDirector();
    const output = director.tick({ midpointM: { x: 1, y: 2, z: 3 }, progressFraction: 0.5, fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    expect(output.focusPositionM).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('orbits continuously — the camera position keeps changing tick to tick even at fixed progress', () => {
    const director = new ClashCameraDirector();
    const first = director.tick({ midpointM: MIDPOINT, progressFraction: 0, fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const second = director.tick({ midpointM: MIDPOINT, progressFraction: 0, fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    expect(second.cameraPositionM).not.toEqual(first.cameraPositionM);
  });

  it('escalates FOV and shake amplitude as progress increases', () => {
    const early = new ClashCameraDirector().tick({ midpointM: MIDPOINT, progressFraction: 0, fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const late = new ClashCameraDirector().tick({ midpointM: MIDPOINT, progressFraction: 1, fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    expect(late.fovDeg).toBeGreaterThan(early.fovDeg);
    const earlyShakeMagnitude = Math.hypot(early.shakeOffsetM.x, early.shakeOffsetM.y, early.shakeOffsetM.z);
    const lateShakeMagnitude = Math.hypot(late.shakeOffsetM.x, late.shakeOffsetM.y, late.shakeOffsetM.z);
    expect(lateShakeMagnitude).toBeGreaterThanOrEqual(earlyShakeMagnitude);
  });

  it('pulls the camera closer to the midpoint as progress increases (distance shrinks)', () => {
    const distanceAt = (progressFraction: number): number => {
      const output = new ClashCameraDirector().tick({ midpointM: MIDPOINT, progressFraction, fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      return Math.hypot(output.cameraPositionM.x - MIDPOINT.x, output.cameraPositionM.z - MIDPOINT.z);
    };
    expect(distanceAt(1)).toBeLessThan(distanceAt(0));
  });

  it('clamps an out-of-range progressFraction instead of extrapolating past the intended escalation', () => {
    const overshoot = new ClashCameraDirector().tick({ midpointM: MIDPOINT, progressFraction: 5, fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const atMax = new ClashCameraDirector().tick({ midpointM: MIDPOINT, progressFraction: 1, fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    expect(overshoot.fovDeg).toBeCloseTo(atMax.fovDeg, 5);
  });

  it('reset() returns the orbit to the same deterministic starting angle every time', () => {
    const director = new ClashCameraDirector();
    for (let i = 0; i < 37; i++) director.tick({ midpointM: MIDPOINT, progressFraction: 0.5, fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    director.reset();
    const afterFirstReset = director.tick({ midpointM: MIDPOINT, progressFraction: 0, fixedDeltaSeconds: FIXED_DELTA_SECONDS });

    for (let i = 0; i < 91; i++) director.tick({ midpointM: MIDPOINT, progressFraction: 0.8, fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    director.reset();
    const afterSecondReset = director.tick({ midpointM: MIDPOINT, progressFraction: 0, fixedDeltaSeconds: FIXED_DELTA_SECONDS });

    expect(afterSecondReset.cameraPositionM).toEqual(afterFirstReset.cameraPositionM);
  });
});
