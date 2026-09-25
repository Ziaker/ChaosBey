// ============================================================
// COMBAT CAMERA CONTROLLER SELF-TESTS
// Pure-logic tests (no Three.js/physics needed) covering the owner-
// approved "Hybrid scalable" (profile C) behavior: base framing/speed-FOV
// when nothing is happening, and shake/hitstop/FOV-punch/knockback-follow
// that scale with ImpactEvent.magnitude, floor out below a minimum (small
// hits stay clean), and always decay back to baseline.
// ============================================================

import { describe, expect, it } from 'vitest';
import { CombatCameraController, type CombatCameraOutput } from '../../src/camera/CombatCameraController';
import type { ImpactEvent } from '../../src/camera/ImpactEvents';
import {
  CAMERA_BASE_DISTANCE_M,
  CAMERA_BASE_HEIGHT_M,
  CAMERA_FOV_BASE_DEG,
  CAMERA_FOV_MAX_SPEED_BONUS_DEG,
  CAMERA_HIGH_SPEED_EXTRA_DISTANCE_M,
  CAMERA_HIGH_SPEED_EXTRA_FOV_DEG,
  CAMERA_HIGH_SPEED_EXTRA_HEIGHT_M,
  CAMERA_HIGH_SPEED_FULL_BLEND_MPS,
  CAMERA_HIGH_SPEED_THRESHOLD_MPS,
  CAMERA_HITSTOP_MAX_DURATION_S,
  CAMERA_MAX_DISTANCE_M,
} from '../../src/camera/CameraTuning';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';

const STATIONARY = { x: 0, y: 0, z: 0 };

function tickMany(
  controller: CombatCameraController,
  count: number,
  overrides: Partial<Parameters<CombatCameraController['tick']>[0]> = {},
): CombatCameraOutput {
  let output: CombatCameraOutput | undefined;
  for (let i = 0; i < count; i++) {
    output = controller.tick({
      firstPositionM: STATIONARY,
      secondPositionM: STATIONARY,
      firstSpeedMps: 0,
      secondSpeedMps: 0,
      firstVelocityXZ: { x: 0, z: 0 },
      impactEvents: [],
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
      ...overrides,
    });
  }
  return output!;
}

/** Horizontal (X/Z) distance from focus to camera — the real "how far back" measure now that the camera orbits the player->opponent axis instead of always sitting on world +Z. */
function horizontalDistanceM(output: CombatCameraOutput): number {
  return Math.hypot(output.cameraPositionM.x - output.focusPositionM.x, output.cameraPositionM.z - output.focusPositionM.z);
}

describe('base framing (no events, a real player->opponent separation along +Z)', () => {
  it('settles on the midpoint, base distance/height and base FOV', () => {
    const controller = new CombatCameraController();
    // Separation (2m) stays under CAMERA_SEPARATION_REFERENCE_M (3m) so
    // separation-based zoom doesn't add extra distance here — that's
    // covered by its own describe block below.
    const first = { x: 0, y: 0, z: -1 };
    const second = { x: 0, y: 0, z: 1 };
    const output = tickMany(controller, 600, { firstPositionM: first, secondPositionM: second });

    expect(output.focusPositionM.x).toBeCloseTo(0, 1);
    expect(output.focusPositionM.z).toBeCloseTo(0, 1);
    expect(output.cameraPositionM.y - output.focusPositionM.y).toBeCloseTo(CAMERA_BASE_HEIGHT_M, 2);
    expect(horizontalDistanceM(output)).toBeCloseTo(CAMERA_BASE_DISTANCE_M, 1);
    expect(output.fovDeg).toBeCloseTo(CAMERA_FOV_BASE_DEG, 1);
    expect(output.isHitstopActive).toBe(false);
    expect(Math.hypot(output.shakeOffsetM.x, output.shakeOffsetM.y, output.shakeOffsetM.z)).toBeCloseTo(0, 3);
  });
});

describe('separation-based zoom', () => {
  it('zooms out as the two Beys separate, capped at the max distance', () => {
    const controller = new CombatCameraController();
    const first = { x: 0, y: 0, z: -30 };
    const second = { x: 0, y: 0, z: 30 };
    const output = tickMany(controller, 300, { firstPositionM: first, secondPositionM: second });

    expect(horizontalDistanceM(output)).toBeCloseTo(CAMERA_MAX_DISTANCE_M, 1);
  });
});

describe('opponent-focused framing follows the live player->opponent axis (not a fixed world axis)', () => {
  it('rotating the whole fight configuration 90° in the X/Z plane rotates the camera framing by the same 90°', () => {
    const controllerZ = new CombatCameraController();
    const outputZ = tickMany(controllerZ, 600, { firstPositionM: { x: 0, y: 0, z: -5 }, secondPositionM: { x: 0, y: 0, z: 5 } });

    const controllerX = new CombatCameraController();
    const outputX = tickMany(controllerX, 600, { firstPositionM: { x: -5, y: 0, z: 0 }, secondPositionM: { x: 5, y: 0, z: 0 } });

    const offsetZ = { x: outputZ.cameraPositionM.x - outputZ.focusPositionM.x, z: outputZ.cameraPositionM.z - outputZ.focusPositionM.z };
    const offsetX = { x: outputX.cameraPositionM.x - outputX.focusPositionM.x, z: outputX.cameraPositionM.z - outputX.focusPositionM.z };

    // Same horizontal distance in both — separation magnitude is
    // identical, only the configuration's orientation in the world
    // changed.
    expect(Math.hypot(offsetX.x, offsetX.z)).toBeCloseTo(Math.hypot(offsetZ.x, offsetZ.z), 1);

    // The camera's own offset must rotate along with the fight — a
    // fixed-world-axis camera (the bug being fixed here) would leave
    // offsetX identical to offsetZ instead of rotating ~90° with it.
    const angleZ = Math.atan2(offsetZ.x, offsetZ.z);
    const angleX = Math.atan2(offsetX.x, offsetX.z);
    const angleDeltaRad = Math.atan2(Math.sin(angleX - angleZ), Math.cos(angleX - angleZ));
    expect(Math.abs(angleDeltaRad)).toBeCloseTo(Math.PI / 2, 1);
  });

  it('orbits smoothly toward a new axis instead of snapping to it in one tick', () => {
    const controller = new CombatCameraController();
    const settled = tickMany(controller, 600, { firstPositionM: { x: 0, y: 0, z: -5 }, secondPositionM: { x: 0, y: 0, z: 5 } });
    const offsetBeforeFlip = { x: settled.cameraPositionM.x - settled.focusPositionM.x, z: settled.cameraPositionM.z - settled.focusPositionM.z };

    // Abruptly flip the fight axis 90° (+Z -> +X) on a single tick. Both
    // configurations share the same midpoint (0,0,0), so this isolates
    // orbit smoothing from focus-position smoothing.
    const afterOneTick = controller.tick({
      firstPositionM: { x: -5, y: 0, z: 0 },
      secondPositionM: { x: 5, y: 0, z: 0 },
      firstSpeedMps: 0,
      secondSpeedMps: 0,
      firstVelocityXZ: { x: 0, z: 0 },
      impactEvents: [],
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
    });
    const offsetAfterOneTick = { x: afterOneTick.cameraPositionM.x - afterOneTick.focusPositionM.x, z: afterOneTick.cameraPositionM.z - afterOneTick.focusPositionM.z };

    // A single tick barely moves the orbit — still much closer to the
    // pre-flip offset than to the fully-rotated new one.
    const distToOld = Math.hypot(offsetAfterOneTick.x - offsetBeforeFlip.x, offsetAfterOneTick.z - offsetBeforeFlip.z);
    const fullyRotated = tickMany(controller, 600, { firstPositionM: { x: -5, y: 0, z: 0 }, secondPositionM: { x: 5, y: 0, z: 0 } });
    const offsetFullyRotated = { x: fullyRotated.cameraPositionM.x - fullyRotated.focusPositionM.x, z: fullyRotated.cameraPositionM.z - fullyRotated.focusPositionM.z };
    const distToNew = Math.hypot(offsetAfterOneTick.x - offsetFullyRotated.x, offsetAfterOneTick.z - offsetFullyRotated.z);

    expect(distToOld).toBeLessThan(distToNew);
  });
});

describe('speed lines screen-direction projection', () => {
  it('is ~zero when the player is still, and reacts to the actual direction of travel (not just its magnitude)', () => {
    const first = { x: 0, y: 0, z: -5 };
    const second = { x: 0, y: 0, z: 5 };

    const stillController = new CombatCameraController();
    const stillOutput = tickMany(stillController, 600, { firstPositionM: first, secondPositionM: second, firstVelocityXZ: { x: 0, z: 0 } });
    expect(Math.hypot(stillOutput.speedLinesScreenDirection.x, stillOutput.speedLinesScreenDirection.y)).toBeCloseTo(0, 3);

    const movingRightController = new CombatCameraController();
    tickMany(movingRightController, 600, { firstPositionM: first, secondPositionM: second });
    const movingRight = movingRightController.tick({
      firstPositionM: first,
      secondPositionM: second,
      firstSpeedMps: 5,
      secondSpeedMps: 0,
      firstVelocityXZ: { x: 5, z: 0 },
      impactEvents: [],
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
    });
    const movingForwardController = new CombatCameraController();
    tickMany(movingForwardController, 600, { firstPositionM: first, secondPositionM: second });
    const movingForward = movingForwardController.tick({
      firstPositionM: first,
      secondPositionM: second,
      firstSpeedMps: 5,
      secondSpeedMps: 0,
      firstVelocityXZ: { x: 0, z: 5 },
      impactEvents: [],
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
    });

    const magRight = Math.hypot(movingRight.speedLinesScreenDirection.x, movingRight.speedLinesScreenDirection.y);
    const magForward = Math.hypot(movingForward.speedLinesScreenDirection.x, movingForward.speedLinesScreenDirection.y);
    expect(magRight).toBeGreaterThan(0);
    expect(magForward).toBeGreaterThan(0);

    // Two different world-space travel directions must not project to the
    // same screen direction — otherwise the VFX layer couldn't tell them
    // apart (the bug being fixed: direction must track real movement).
    const angleRight = Math.atan2(movingRight.speedLinesScreenDirection.y, movingRight.speedLinesScreenDirection.x);
    const angleForward = Math.atan2(movingForward.speedLinesScreenDirection.y, movingForward.speedLinesScreenDirection.x);
    const angleDelta = Math.atan2(Math.sin(angleRight - angleForward), Math.cos(angleRight - angleForward));
    expect(Math.abs(angleDelta)).toBeGreaterThan(0.2);
  });
});

describe('speed FOV', () => {
  it('widens toward the max speed bonus at high combined speed, isolated from high-speed camera (each Bey individually below its threshold)', () => {
    const controller = new CombatCameraController();
    // Combined (11 + 11 = 22) saturates CAMERA_FOV_SPEED_REFERENCE_MPS,
    // but each Bey individually (11) stays below CAMERA_HIGH_SPEED_
    // THRESHOLD_MPS (14) — isolates speed-FOV from the separate
    // high-speed-camera blend tested below.
    const output = tickMany(controller, 300, { firstSpeedMps: 11, secondSpeedMps: 11 });

    expect(output.fovDeg).toBeCloseTo(CAMERA_FOV_BASE_DEG + CAMERA_FOV_MAX_SPEED_BONUS_DEG, 1);
    expect(output.highSpeedBlend).toBeCloseTo(0, 2);
  });
});

describe('high-speed camera (distinct from speed FOV)', () => {
  it('stays negligible at ordinary individual speed, even if combined speed is high', () => {
    const controller = new CombatCameraController();
    // Same combined speed as the speed-FOV test above — high-speed camera
    // must not engage from combined speed alone.
    const output = tickMany(controller, 300, { firstSpeedMps: 11, secondSpeedMps: 11 });

    expect(output.highSpeedBlend).toBeCloseTo(0, 2);
  });

  it('blends in a pullback/higher-angle/extra-FOV once either Bey is genuinely at extreme individual speed (e.g. a Dash Attack), capped at the full-blend reference', () => {
    const controller = new CombatCameraController();
    const output = tickMany(controller, 300, { firstSpeedMps: CAMERA_HIGH_SPEED_FULL_BLEND_MPS, secondSpeedMps: 0 });

    expect(output.highSpeedBlend).toBeCloseTo(1, 1);
    const distanceM = horizontalDistanceM(output);
    const heightM = output.cameraPositionM.y - output.focusPositionM.y;
    expect(distanceM).toBeCloseTo(CAMERA_BASE_DISTANCE_M + CAMERA_HIGH_SPEED_EXTRA_DISTANCE_M, 1);
    expect(heightM).toBeCloseTo(CAMERA_BASE_HEIGHT_M + CAMERA_HIGH_SPEED_EXTRA_HEIGHT_M, 1);
    expect(output.fovDeg).toBeGreaterThanOrEqual(CAMERA_FOV_BASE_DEG + CAMERA_HIGH_SPEED_EXTRA_FOV_DEG - 0.5);
  });

  it('never exceeds full blend (capped) far beyond the reference speed, and transitions back to negligible when speed drops again', () => {
    const controller = new CombatCameraController();
    const atExtremeSpeed = tickMany(controller, 300, { firstSpeedMps: CAMERA_HIGH_SPEED_FULL_BLEND_MPS * 3, secondSpeedMps: 0 });
    expect(atExtremeSpeed.highSpeedBlend).toBeLessThanOrEqual(1.001);
    expect(atExtremeSpeed.highSpeedBlend).toBeCloseTo(1, 1);

    const backToNormal = tickMany(controller, 300, { firstSpeedMps: 0, secondSpeedMps: 0 });
    expect(backToNormal.highSpeedBlend).toBeCloseTo(0, 1);
  });

  it('threshold sanity: a speed right at the threshold produces ~0 blend, matching the fraction formula', () => {
    const controller = new CombatCameraController();
    const output = tickMany(controller, 300, { firstSpeedMps: CAMERA_HIGH_SPEED_THRESHOLD_MPS, secondSpeedMps: 0 });
    expect(output.highSpeedBlend).toBeCloseTo(0, 1);
  });
});

describe('impact response scaling', () => {
  it('a strong impact (magnitude 1, e.g. a KO) triggers both shake and hitstop, which decay back to nothing', () => {
    const controller = new CombatCameraController();
    const koEvent: ImpactEvent = { kind: 'ko', magnitude: 1, worldPositionM: STATIONARY, isFirst: true };

    const immediate = controller.tick({
      firstPositionM: STATIONARY,
      secondPositionM: STATIONARY,
      firstSpeedMps: 0,
      secondSpeedMps: 0,
      firstVelocityXZ: { x: 0, z: 0 },
      impactEvents: [koEvent],
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
    });

    expect(immediate.isHitstopActive).toBe(true);
    expect(immediate.hitstopRemainingS).toBeGreaterThan(0);
    expect(Math.hypot(immediate.shakeOffsetM.x, immediate.shakeOffsetM.y, immediate.shakeOffsetM.z)).toBeGreaterThan(0);

    // Enough real time for both the (capped) hitstop duration and the
    // shake's exponential decay to fully settle.
    const settleTicks = Math.ceil((CAMERA_HITSTOP_MAX_DURATION_S + 2) / FIXED_DELTA_SECONDS);
    const settled = tickMany(controller, settleTicks);

    expect(settled.isHitstopActive).toBe(false);
    expect(settled.hitstopRemainingS).toBe(0);
    expect(Math.hypot(settled.shakeOffsetM.x, settled.shakeOffsetM.y, settled.shakeOffsetM.z)).toBeCloseTo(0, 2);
  });

  it('a sub-hitstop but shake-eligible magnitude (e.g. a clean dodge) shakes the camera without ever freezing gameplay', () => {
    const controller = new CombatCameraController();
    const dodgedEvent: ImpactEvent = { kind: 'dodged', magnitude: 0.2, worldPositionM: STATIONARY, isFirst: true };

    const immediate = controller.tick({
      firstPositionM: STATIONARY,
      secondPositionM: STATIONARY,
      firstSpeedMps: 0,
      secondSpeedMps: 0,
      firstVelocityXZ: { x: 0, z: 0 },
      impactEvents: [dodgedEvent],
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
    });

    expect(immediate.isHitstopActive).toBe(false);
    expect(Math.hypot(immediate.shakeOffsetM.x, immediate.shakeOffsetM.y, immediate.shakeOffsetM.z)).toBeGreaterThan(0);
  });

  it('a tiny magnitude below the shake floor triggers neither shake nor hitstop (routine contact stays clean)', () => {
    const controller = new CombatCameraController();
    const tinyEvent: ImpactEvent = { kind: 'wallImpact', magnitude: 0.03, worldPositionM: STATIONARY, isFirst: true };

    const immediate = controller.tick({
      firstPositionM: STATIONARY,
      secondPositionM: STATIONARY,
      firstSpeedMps: 0,
      secondSpeedMps: 0,
      firstVelocityXZ: { x: 0, z: 0 },
      impactEvents: [tinyEvent],
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
    });

    expect(immediate.isHitstopActive).toBe(false);
    expect(Math.hypot(immediate.shakeOffsetM.x, immediate.shakeOffsetM.y, immediate.shakeOffsetM.z)).toBe(0);
  });
});

describe('knockback follow', () => {
  it('biases the focus point toward a Bey that was just launched, then decays back to the midpoint', () => {
    const first = { x: 0, y: 0, z: -20 };
    const second = { x: 0, y: 0, z: 20 };

    const withoutBias = new CombatCameraController();
    const withBias = new CombatCameraController();
    let outputWithout = tickMany(withoutBias, 300, { firstPositionM: first, secondPositionM: second });
    let outputWith = tickMany(withBias, 300, { firstPositionM: first, secondPositionM: second });

    // Both have settled on the midpoint (z=0) with no events yet.
    expect(outputWithout.focusPositionM.z).toBeCloseTo(0, 1);
    expect(outputWith.focusPositionM.z).toBeCloseTo(0, 1);

    const hitOnFirst: ImpactEvent = { kind: 'hit', magnitude: 1, worldPositionM: first, isFirst: true };
    outputWith = withBias.tick({
      firstPositionM: first,
      secondPositionM: second,
      firstSpeedMps: 0,
      secondSpeedMps: 0,
      firstVelocityXZ: { x: 0, z: 0 },
      impactEvents: [hitOnFirst],
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
    });
    outputWithout = withoutBias.tick({
      firstPositionM: first,
      secondPositionM: second,
      firstSpeedMps: 0,
      secondSpeedMps: 0,
      firstVelocityXZ: { x: 0, z: 0 },
      impactEvents: [],
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
    });

    // "first" sits at negative z — a bias toward it pulls focus.z down,
    // measurably below the still-at-the-midpoint unbiased run.
    expect(outputWith.focusPositionM.z).toBeLessThan(outputWithout.focusPositionM.z - 0.01);

    const settled = tickMany(withBias, 300, { firstPositionM: first, secondPositionM: second });
    expect(settled.focusPositionM.z).toBeCloseTo(0, 1);
  });
});
