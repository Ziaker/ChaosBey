// ============================================================
// COMBAT CAMERA CONTROLLER
// Milestone 4's camera "director": pure logic (no Three.js dependency, so
// it's fully unit-testable — GDD section 114/150) that turns Bey
// positions/speeds plus this tick's ImpactEvents into a smoothed camera
// position/focus/FOV, a shake offset, and hitstop state. main.ts is the
// only thing that touches the real THREE.PerspectiveCamera with this
// output.
//
// Speed FOV and "high-speed camera" are separate GDD-listed responses:
// speed FOV widens smoothly with *combined* speed at all times, while
// high-speed camera (highSpeedBlend) only engages once either Bey's
// *individual* speed gets genuinely extreme (e.g. a Dash Attack) — a
// further, conservative pullback/higher-angle/wider-FOV blended on top,
// negligible the rest of the time (profile C).
//
// Every response scales with ImpactEvent.magnitude (0..1, already run
// through the owner-approved "Hybrid scalable" profile C curve — see
// ImpactMagnitude.ts) and is capped, so nothing ever locks up (hitstop),
// blinds the player (FOV punch), or makes small/routine contact read as a
// big deal (shake/knockback-follow both have a minimum-magnitude floor
// below which they do nothing at all).
// ============================================================

import type { ImpactEvent, WorldPositionM } from './ImpactEvents';
import {
  CAMERA_BASE_DISTANCE_M,
  CAMERA_BASE_HEIGHT_M,
  CAMERA_FOV_BASE_DEG,
  CAMERA_FOV_MAX_SPEED_BONUS_DEG,
  CAMERA_FOV_PUNCH_DECAY_PER_S,
  CAMERA_FOV_PUNCH_MAX_DEG,
  CAMERA_FOV_SMOOTHING_PER_S,
  CAMERA_FOV_SPEED_REFERENCE_MPS,
  CAMERA_HIGH_SPEED_BLEND_SMOOTHING_PER_S,
  CAMERA_HIGH_SPEED_EXTRA_DISTANCE_M,
  CAMERA_HIGH_SPEED_EXTRA_FOV_DEG,
  CAMERA_HIGH_SPEED_EXTRA_HEIGHT_M,
  CAMERA_HIGH_SPEED_FULL_BLEND_MPS,
  CAMERA_HIGH_SPEED_THRESHOLD_MPS,
  CAMERA_HITSTOP_DURATION_PER_MAGNITUDE_S,
  CAMERA_HITSTOP_MAX_DURATION_S,
  CAMERA_HITSTOP_MIN_MAGNITUDE,
  CAMERA_KNOCKBACK_FOLLOW_BIAS_MAX,
  CAMERA_KNOCKBACK_FOLLOW_DECAY_PER_S,
  CAMERA_MAX_DISTANCE_M,
  CAMERA_MIN_DISTANCE_M,
  CAMERA_POSITION_SMOOTHING_PER_S,
  CAMERA_SEPARATION_REFERENCE_M,
  CAMERA_SEPARATION_TO_DISTANCE_FACTOR,
  CAMERA_SHAKE_AMPLITUDE_REFERENCE_M,
  CAMERA_SHAKE_DECAY_PER_S,
  CAMERA_SHAKE_FREQUENCY_HZ,
  CAMERA_SHAKE_MIN_MAGNITUDE,
} from './CameraTuning';

/** Event kinds that plausibly involve a Bey being launched/thrown — the only ones eligible to bias camera focus via "knockback follow". */
const KNOCKBACK_FOLLOW_EVENT_KINDS = new Set(['hit', 'stabilityBreak', 'ko', 'ringOut']);

export interface CombatCameraTickInput {
  firstPositionM: WorldPositionM;
  secondPositionM: WorldPositionM;
  firstSpeedMps: number;
  secondSpeedMps: number;
  /** This tick's fresh impact events — pass an empty array on a tick where gameplay itself didn't advance (e.g. frozen by hitstop), so nothing re-triggers. */
  impactEvents: ImpactEvent[];
  fixedDeltaSeconds: number;
}

export interface CombatCameraOutput {
  /** Smoothed eye position, before shakeOffsetM is added. */
  cameraPositionM: WorldPositionM;
  /** Smoothed look-at target. */
  focusPositionM: WorldPositionM;
  shakeOffsetM: WorldPositionM;
  fovDeg: number;
  isHitstopActive: boolean;
  hitstopRemainingS: number;
  /** 0..1 — how "high-speed camera" mode is currently blended in (see CameraTuning's CAMERA_HIGH_SPEED_* constants). Negligible at ordinary speed, ramping up only at genuinely extreme individual speed (e.g. a Dash Attack). */
  highSpeedBlend: number;
}

function lerpVec3(a: WorldPositionM, b: WorldPositionM, t: number): WorldPositionM {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export class CombatCameraController {
  private cameraPositionM: WorldPositionM = { x: 0, y: CAMERA_BASE_HEIGHT_M, z: CAMERA_BASE_DISTANCE_M };
  private focusPositionM: WorldPositionM = { x: 0, y: 0, z: 0 };
  private currentFovDeg = CAMERA_FOV_BASE_DEG;
  private fovPunchDeg = 0;
  private shakeAmplitudeM = 0;
  private shakePhaseRad = 0;
  private hitstopRemainingS = 0;
  private knockbackFollowBias = 0;
  private knockbackFollowTargetIsFirst = true;
  private highSpeedBlend = 0;

  tick(input: CombatCameraTickInput): CombatCameraOutput {
    const { firstPositionM, secondPositionM, firstSpeedMps, secondSpeedMps, impactEvents, fixedDeltaSeconds } = input;

    for (const event of impactEvents) {
      if (event.magnitude >= CAMERA_HITSTOP_MIN_MAGNITUDE) {
        const duration = Math.min(CAMERA_HITSTOP_MAX_DURATION_S, event.magnitude * CAMERA_HITSTOP_DURATION_PER_MAGNITUDE_S);
        this.hitstopRemainingS = Math.max(this.hitstopRemainingS, duration);
      }
      if (event.magnitude >= CAMERA_SHAKE_MIN_MAGNITUDE) {
        this.shakeAmplitudeM = Math.max(this.shakeAmplitudeM, event.magnitude * CAMERA_SHAKE_AMPLITUDE_REFERENCE_M);
      }
      this.fovPunchDeg = Math.max(this.fovPunchDeg, event.magnitude * CAMERA_FOV_PUNCH_MAX_DEG);
      if (KNOCKBACK_FOLLOW_EVENT_KINDS.has(event.kind)) {
        const bias = Math.min(CAMERA_KNOCKBACK_FOLLOW_BIAS_MAX, event.magnitude * CAMERA_KNOCKBACK_FOLLOW_BIAS_MAX);
        if (bias >= this.knockbackFollowBias) {
          this.knockbackFollowBias = bias;
          this.knockbackFollowTargetIsFirst = event.isFirst;
        }
      }
    }

    // Real-time decay — runs every tick regardless of whether gameplay
    // itself is currently frozen by hitstop, so the freeze actually ends.
    this.hitstopRemainingS = Math.max(0, this.hitstopRemainingS - fixedDeltaSeconds);
    this.shakeAmplitudeM *= Math.exp(-CAMERA_SHAKE_DECAY_PER_S * fixedDeltaSeconds);
    if (this.shakeAmplitudeM < 0.001) this.shakeAmplitudeM = 0;
    this.shakePhaseRad += CAMERA_SHAKE_FREQUENCY_HZ * Math.PI * 2 * fixedDeltaSeconds;
    this.fovPunchDeg *= Math.exp(-CAMERA_FOV_PUNCH_DECAY_PER_S * fixedDeltaSeconds);
    if (this.fovPunchDeg < 0.01) this.fovPunchDeg = 0;
    this.knockbackFollowBias *= Math.exp(-CAMERA_KNOCKBACK_FOLLOW_DECAY_PER_S * fixedDeltaSeconds);
    if (this.knockbackFollowBias < 0.001) this.knockbackFollowBias = 0;

    const midpoint: WorldPositionM = {
      x: (firstPositionM.x + secondPositionM.x) / 2,
      y: (firstPositionM.y + secondPositionM.y) / 2,
      z: (firstPositionM.z + secondPositionM.z) / 2,
    };
    const followTarget = this.knockbackFollowTargetIsFirst ? firstPositionM : secondPositionM;
    const desiredFocus = lerpVec3(midpoint, followTarget, this.knockbackFollowBias);

    // High-speed camera (distinct from speed FOV below): negligible at
    // ordinary speed, blending in only once either Bey's *individual*
    // speed gets genuinely extreme (e.g. a Dash Attack) — a further,
    // conservative pullback/higher-angle/wider-FOV on top of everything
    // else, smoothed so it can't snap in or out.
    const fastestSpeedMps = Math.max(firstSpeedMps, secondSpeedMps);
    const highSpeedFraction = Math.max(
      0,
      Math.min(1, (fastestSpeedMps - CAMERA_HIGH_SPEED_THRESHOLD_MPS) / (CAMERA_HIGH_SPEED_FULL_BLEND_MPS - CAMERA_HIGH_SPEED_THRESHOLD_MPS)),
    );
    const highSpeedSmoothingT = 1 - Math.exp(-CAMERA_HIGH_SPEED_BLEND_SMOOTHING_PER_S * fixedDeltaSeconds);
    this.highSpeedBlend += (highSpeedFraction - this.highSpeedBlend) * highSpeedSmoothingT;

    const separationM = Math.hypot(
      firstPositionM.x - secondPositionM.x,
      firstPositionM.y - secondPositionM.y,
      firstPositionM.z - secondPositionM.z,
    );
    const extraSeparationM = Math.max(0, separationM - CAMERA_SEPARATION_REFERENCE_M);
    const separationDistanceM = CAMERA_BASE_DISTANCE_M + extraSeparationM * CAMERA_SEPARATION_TO_DISTANCE_FACTOR;
    const desiredDistanceM = Math.min(
      CAMERA_MAX_DISTANCE_M,
      Math.max(CAMERA_MIN_DISTANCE_M, separationDistanceM + this.highSpeedBlend * CAMERA_HIGH_SPEED_EXTRA_DISTANCE_M),
    );
    const desiredCameraPosition: WorldPositionM = {
      x: desiredFocus.x,
      y: desiredFocus.y + CAMERA_BASE_HEIGHT_M + this.highSpeedBlend * CAMERA_HIGH_SPEED_EXTRA_HEIGHT_M,
      z: desiredFocus.z + desiredDistanceM,
    };

    const positionSmoothingT = 1 - Math.exp(-CAMERA_POSITION_SMOOTHING_PER_S * fixedDeltaSeconds);
    this.focusPositionM = lerpVec3(this.focusPositionM, desiredFocus, positionSmoothingT);
    this.cameraPositionM = lerpVec3(this.cameraPositionM, desiredCameraPosition, positionSmoothingT);

    const combinedSpeedMps = firstSpeedMps + secondSpeedMps;
    const speedFraction = Math.max(0, Math.min(1, combinedSpeedMps / CAMERA_FOV_SPEED_REFERENCE_MPS));
    const desiredBaseFovDeg = CAMERA_FOV_BASE_DEG + speedFraction * CAMERA_FOV_MAX_SPEED_BONUS_DEG;
    const fovSmoothingT = 1 - Math.exp(-CAMERA_FOV_SMOOTHING_PER_S * fixedDeltaSeconds);
    this.currentFovDeg += (desiredBaseFovDeg - this.currentFovDeg) * fovSmoothingT;

    // Deterministic oscillation (not Math.random) so the same event
    // sequence always produces the same shake — reproducible in tests and
    // any future replay/self-test tooling.
    const shakeOffsetM: WorldPositionM = {
      x: Math.sin(this.shakePhaseRad) * this.shakeAmplitudeM,
      y: Math.sin(this.shakePhaseRad * 1.7 + 1.3) * this.shakeAmplitudeM * 0.6,
      z: Math.cos(this.shakePhaseRad * 1.3) * this.shakeAmplitudeM,
    };

    return {
      cameraPositionM: { ...this.cameraPositionM },
      focusPositionM: { ...this.focusPositionM },
      shakeOffsetM,
      fovDeg: this.currentFovDeg + this.fovPunchDeg + this.highSpeedBlend * CAMERA_HIGH_SPEED_EXTRA_FOV_DEG,
      isHitstopActive: this.hitstopRemainingS > 0,
      hitstopRemainingS: this.hitstopRemainingS,
      highSpeedBlend: this.highSpeedBlend,
    };
  }
}
