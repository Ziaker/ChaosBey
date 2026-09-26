// ============================================================
// COMBAT CAMERA CONTROLLER
// Milestone 4's camera "director": pure logic (no Three.js dependency, so
// it's fully unit-testable — GDD section 114/150) that turns Bey
// positions/speeds plus this tick's ImpactEvents into a smoothed camera
// position/focus/FOV, a shake offset, and hitstop state. main.ts is the
// only thing that touches the real THREE.PerspectiveCamera with this
// output.
//
// GDD camera identity: opponent-focused, semi-over-the-shoulder, with
// automatic orbit/contextual placement — NOT a fixed-world-axis tripod.
// "first" is the player, "second" the opponent throughout this file
// (matching the codebase-wide convention). The camera sits behind the
// player, offset to one shoulder (CAMERA_SHOULDER_OFFSET_RAD), oriented
// along the live player->opponent axis; that orientation itself orbits
// smoothly (CAMERA_ORBIT_SMOOTHING_PER_S) rather than snapping as the
// fighters move around the arena, so rotating the whole fight in the
// world produces a correspondingly rotated — not fixed — framing.
// Dedicated Clash/Ring-Out/Finisher cameras are a later milestone; this is
// only the base "combat follow" behavior they'll build on.
//
// Speed FOV and "high-speed camera" are separate GDD-listed responses:
// speed FOV widens smoothly with *combined* speed at all times, while
// high-speed camera (highSpeedBlend) only engages once either Bey's
// *individual* speed gets genuinely extreme (e.g. a Dash Attack) — a
// further, conservative pullback/higher-angle/wider-FOV blended on top,
// negligible the rest of the time (profile C).
//
// Every impact response scales with ImpactEvent.magnitude (0..1, already
// run through the owner-approved "Hybrid scalable" profile C curve — see
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
  CAMERA_ORBIT_SMOOTHING_PER_S,
  CAMERA_POSITION_SMOOTHING_PER_S,
  CAMERA_SEPARATION_REFERENCE_M,
  CAMERA_SEPARATION_TO_DISTANCE_FACTOR,
  CAMERA_SHAKE_AMPLITUDE_REFERENCE_M,
  CAMERA_SHAKE_DECAY_PER_S,
  CAMERA_SHAKE_FREQUENCY_HZ,
  CAMERA_SHAKE_MIN_MAGNITUDE,
  CAMERA_SHOULDER_OFFSET_RAD,
} from './CameraTuning';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function subtract3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize3(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z);
  return len > 1e-6 ? { x: a.x / len, y: a.y / len, z: a.z / len } : { x: 0, y: 0, z: 0 };
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };

/** Unit vector in the XZ plane from a yaw angle, matching Vec2.fromYaw's convention (yaw 0 => +Z). Duplicated locally (not imported from physics/Vec2) since this is a 3D-position module, not a Vec2 one. */
function xzFromYaw(yawRad: number): { x: number; z: number } {
  return { x: Math.sin(yawRad), z: Math.cos(yawRad) };
}

/** Smoothly interpolates an angle toward `target`, taking the shorter way around the ±π wraparound — a plain lerp would spin the long way whenever the two angles cross that boundary. */
function smoothAngleRad(current: number, target: number, t: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * t;
}

/** Event kinds that plausibly involve a Bey being launched/thrown — the only ones eligible to bias camera focus via "knockback follow". */
const KNOCKBACK_FOLLOW_EVENT_KINDS = new Set(['hit', 'stabilityBreak', 'ko', 'ringOut', 'clashResolved']);

export interface CombatCameraTickInput {
  firstPositionM: WorldPositionM;
  secondPositionM: WorldPositionM;
  firstSpeedMps: number;
  secondSpeedMps: number;
  /** The player (first)'s current horizontal velocity — used only to project a camera-relative travel direction for Milestone 4's speed lines (see speedLinesScreenDirection below). Pass {x:0,z:0} if unavailable. */
  firstVelocityXZ: { x: number; z: number };
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
  /**
   * The player's world-space horizontal velocity, projected onto this
   * tick's actual camera right/up axes (x = screen-right component, y =
   * screen-up component) — NOT a world-space XZ vector. Drives Milestone
   * 4's speed lines so their orientation tracks real movement relative to
   * what the camera is actually looking at, per the GDD (no fixed-overlay
   * streaks that ignore direction). Zero when the player isn't moving.
   */
  speedLinesScreenDirection: { x: number; y: number };
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
  private orbitYawRad = 0;
  private orbitYawInitialized = false;

  tick(input: CombatCameraTickInput): CombatCameraOutput {
    const { firstPositionM, secondPositionM, firstSpeedMps, secondSpeedMps, firstVelocityXZ, impactEvents, fixedDeltaSeconds } = input;

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
        // followTargetIsFirst overrides isFirst when the event explicitly
        // sets it (e.g. a Clash's win/loss vs. Tie presentation, where
        // isFirst alone can't represent "no side" — see ImpactEvent).
        // null means this specific event deliberately applies no
        // unilateral follow bias at all, unlike undefined (not set),
        // which simply falls back to isFirst as before this field existed.
        const followTarget = event.followTargetIsFirst !== undefined ? event.followTargetIsFirst : event.isFirst;
        if (followTarget !== null) {
          const bias = Math.min(CAMERA_KNOCKBACK_FOLLOW_BIAS_MAX, event.magnitude * CAMERA_KNOCKBACK_FOLLOW_BIAS_MAX);
          if (bias >= this.knockbackFollowBias) {
            this.knockbackFollowBias = bias;
            this.knockbackFollowTargetIsFirst = followTarget;
          }
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

    // Opponent-focused, semi-over-the-shoulder framing (GDD camera
    // identity): orient the camera along the live player->opponent axis,
    // not a fixed world axis, so rotating the whole fight in the arena
    // produces a correspondingly rotated framing. The axis itself is
    // smoothed into an "orbit" angle rather than snapped every tick, so
    // the camera visibly orbits around the fight as it moves rather than
    // instantly re-aiming.
    const axisXZ = { x: secondPositionM.x - firstPositionM.x, z: secondPositionM.z - firstPositionM.z };
    const axisLengthM = Math.hypot(axisXZ.x, axisXZ.z);
    const targetOrbitYawRad = axisLengthM > 1e-3 ? Math.atan2(axisXZ.x, axisXZ.z) : this.orbitYawRad;
    if (!this.orbitYawInitialized) {
      this.orbitYawRad = targetOrbitYawRad;
      this.orbitYawInitialized = true;
    } else {
      const orbitSmoothingT = 1 - Math.exp(-CAMERA_ORBIT_SMOOTHING_PER_S * fixedDeltaSeconds);
      this.orbitYawRad = smoothAngleRad(this.orbitYawRad, targetOrbitYawRad, orbitSmoothingT);
    }
    // Behind the player (opposite the player->opponent axis), offset to
    // one shoulder — the "semi" in semi-over-the-shoulder.
    const cameraYawRad = this.orbitYawRad + Math.PI + CAMERA_SHOULDER_OFFSET_RAD;
    const cameraDirXZ = xzFromYaw(cameraYawRad);

    const desiredCameraPosition: WorldPositionM = {
      x: desiredFocus.x + cameraDirXZ.x * desiredDistanceM,
      y: desiredFocus.y + CAMERA_BASE_HEIGHT_M + this.highSpeedBlend * CAMERA_HIGH_SPEED_EXTRA_HEIGHT_M,
      z: desiredFocus.z + cameraDirXZ.z * desiredDistanceM,
    };

    const positionSmoothingT = 1 - Math.exp(-CAMERA_POSITION_SMOOTHING_PER_S * fixedDeltaSeconds);
    this.focusPositionM = lerpVec3(this.focusPositionM, desiredFocus, positionSmoothingT);
    this.cameraPositionM = lerpVec3(this.cameraPositionM, desiredCameraPosition, positionSmoothingT);

    // Speed lines (Milestone 4): project the player's world-space
    // velocity onto this tick's actual camera right/up axes, so the VFX
    // layer can orient streaks along the real, camera-relative direction
    // of travel instead of a fixed radial overlay (GDD requirement).
    const cameraForward3 = normalize3(subtract3(this.focusPositionM, this.cameraPositionM));
    const cameraRight3 = normalize3(cross3(cameraForward3, WORLD_UP));
    const cameraUp3 = cross3(cameraRight3, cameraForward3);
    const velocity3: Vec3 = { x: firstVelocityXZ.x, y: 0, z: firstVelocityXZ.z };
    const speedLinesScreenDirection = { x: dot3(velocity3, cameraRight3), y: dot3(velocity3, cameraUp3) };

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
      speedLinesScreenDirection,
    };
  }
}
