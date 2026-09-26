// ============================================================
// CLASH CAMERA DIRECTOR
// Milestone 5's dedicated Clash camera, built on top of the same pure-logic
// approach as Milestone 4's CombatCameraController (GDD section 114/150:
// fully unit-testable, no Three.js dependency). Owner decision (2026-09-25,
// keeping profile C — Hybrid scalable): on entering a Clash, cut to a
// controlled cinematic orbit near the confrontation point (the midpoint
// between the two, frozen Beys) instead of the normal opponent-focused
// follow camera; intensity (orbit speed, pull-in, FOV, shake) escalates
// progressively over the ~4s contest as the mash disputes it, while
// keeping the frame legible enough to read Z/X/C prompts. main.ts hands
// this its own dedicated CombatCameraOutput-shaped result while Active;
// CombatCameraController itself resumes driving the camera immediately
// after resolution (its own knockback-follow bias then naturally settles
// on the loser — see 'clashResolved' in KNOCKBACK_FOLLOW_EVENT_KINDS).
//
// All numeric values are Milestone 5 engineering placeholders (GDD section
// 167) — the escalating-with-progress *shape* is the approved part.
// ============================================================

import type { WorldPositionM } from './ImpactEvents';
import {
  CLASH_CAMERA_BASE_DISTANCE_M,
  CLASH_CAMERA_DISTANCE_PULL_IN_M,
  CLASH_CAMERA_FOV_BASE_DEG,
  CLASH_CAMERA_FOV_MAX_EXTRA_DEG,
  CLASH_CAMERA_HEIGHT_M,
  CLASH_CAMERA_ORBIT_BASE_SPEED_RAD_PER_S,
  CLASH_CAMERA_ORBIT_EXTRA_SPEED_RAD_PER_S,
  CLASH_CAMERA_SHAKE_FREQUENCY_HZ,
  CLASH_CAMERA_SHAKE_MAX_M,
} from './CameraTuning';

export interface ClashCameraTickInput {
  midpointM: WorldPositionM;
  /** 0..1 — how far through the ~4s contest this tick is (elapsedS / CLASH_TARGET_DURATION_S, clamped). Drives every intensity ramp below. */
  progressFraction: number;
  fixedDeltaSeconds: number;
}

export interface ClashCameraOutput {
  cameraPositionM: WorldPositionM;
  focusPositionM: WorldPositionM;
  fovDeg: number;
  shakeOffsetM: WorldPositionM;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

export class ClashCameraDirector {
  private orbitAngleRad = 0;
  private shakePhaseRad = 0;

  tick(input: ClashCameraTickInput): ClashCameraOutput {
    const progressFraction = clamp01(input.progressFraction);
    const { midpointM, fixedDeltaSeconds } = input;

    const orbitSpeedRadPerS = CLASH_CAMERA_ORBIT_BASE_SPEED_RAD_PER_S + progressFraction * CLASH_CAMERA_ORBIT_EXTRA_SPEED_RAD_PER_S;
    this.orbitAngleRad += orbitSpeedRadPerS * fixedDeltaSeconds;
    this.shakePhaseRad += CLASH_CAMERA_SHAKE_FREQUENCY_HZ * Math.PI * 2 * fixedDeltaSeconds;

    const distanceM = CLASH_CAMERA_BASE_DISTANCE_M - progressFraction * CLASH_CAMERA_DISTANCE_PULL_IN_M;
    const cameraPositionM: WorldPositionM = {
      x: midpointM.x + Math.sin(this.orbitAngleRad) * distanceM,
      y: midpointM.y + CLASH_CAMERA_HEIGHT_M,
      z: midpointM.z + Math.cos(this.orbitAngleRad) * distanceM,
    };

    const shakeAmplitudeM = progressFraction * CLASH_CAMERA_SHAKE_MAX_M;
    const shakeOffsetM: WorldPositionM = {
      x: Math.sin(this.shakePhaseRad) * shakeAmplitudeM,
      y: Math.sin(this.shakePhaseRad * 1.7 + 1.3) * shakeAmplitudeM * 0.6,
      z: Math.cos(this.shakePhaseRad * 1.3) * shakeAmplitudeM,
    };

    return {
      cameraPositionM,
      focusPositionM: { ...midpointM },
      fovDeg: CLASH_CAMERA_FOV_BASE_DEG + progressFraction * CLASH_CAMERA_FOV_MAX_EXTRA_DEG,
      shakeOffsetM,
    };
  }

  /** Resets the orbit to a deterministic starting angle — call exactly once, when a NEW Clash starts, so the cinematic beat always begins from the same framing (reproducible in tests and replays) instead of carrying over wherever the previous Clash's orbit happened to end. */
  reset(): void {
    this.orbitAngleRad = 0;
    this.shakePhaseRad = 0;
  }
}
