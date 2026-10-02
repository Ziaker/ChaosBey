// ============================================================
// INERTIAL DUEL CAMERA — GAME PRESENTATION LAYER
//
// The approved CameraDirector remains the context/framing generator for
// distance, height, focus, FOV, shake, Clash, Ring-Out and Finisher. This
// layer changes one authority for normal combat: the player→opponent axis
// no longer dictates camera yaw every tick.
//
// Instead, combat azimuth persists. While both Beys fit comfortably inside
// a screen-space safe frame, yaw does not chase their changing axis at all.
// Framing pressure is resolved in this order:
//   1) focus shift toward the endangered subject;
//   2) camera pull-back;
//   3) FOV opening;
//   4) only then, the minimum-direction yaw correction required to recover
//      composition, with both angular-speed and angular-acceleration caps.
//
// This is presentation only. It consumes FightFrame and emits camera output.
// Nothing here may write gameplay state or feed movement/input.
// ============================================================

import { CameraDirector, type DirectorOptions, type DirectorOutput } from './CameraDirector';
import type { CameraParams, PresetId } from './CameraParams';
import type { FightFrame, FighterFrame, Vec3 } from './FightFrame';
import { clamp, yawOf } from './frameMath';

const DEG = Math.PI / 180;
const MAX_FOV_DEG = 120;
const YAW_SAMPLE_DEG = 6;
const BEHIND_SCORE = 4;
const CINEMATIC_TAKEOVER_THRESHOLD = 0.05;

export interface InertialCompositionTuning {
  /** Horizontal normalized-device-coordinate boundary where non-yaw rescue begins. 1 = screen edge. */
  readonly softFrameX: number;
  /** Vertical NDC boundary where non-yaw rescue begins. */
  readonly softFrameY: number;
  /** Hard horizontal boundary: crossing it permits immediate yaw correction. */
  readonly hardFrameX: number;
  /** Hard vertical boundary: crossing it permits immediate yaw correction. */
  readonly hardFrameY: number;
  /** Time a subject may remain outside the soft frame before yaw becomes eligible. */
  readonly yawTriggerHoldS: number;
  /** Maximum normal-combat camera yaw speed. */
  readonly maxYawRateDegS: number;
  /** Maximum change of yaw speed; prevents +rate/-rate snaps while targets cross. */
  readonly maxYawAccelDegS2: number;
  /** Pull-back available before yaw is used. */
  readonly maxDistanceRescueM: number;
  /** Extra vertical FOV available before yaw is used. */
  readonly maxFovRescueDeg: number;
  /** Maximum interpolation toward the endangered fighter for focus rescue. */
  readonly maxFocusRescue: number;
  /** Time constant for optical rescue to build instead of popping on at the soft boundary. */
  readonly rescueAttackS: number;
  /** Slower release gives focus/distance/FOV hysteresis and prevents boundary pumping. */
  readonly rescueReleaseS: number;
}

// ============================================================
// INERTIAL DUEL CAMERA — TUNING
// A remains the calm/readability preset; B is the balanced baseline; C can
// correct more energetically, but all three obey the same spatial-stability
// rule and are far below the old "chase the fight axis" behaviour.
// ============================================================
export const INERTIAL_DUEL_TUNING: Readonly<Record<PresetId, InertialCompositionTuning>> = {
  A: {
    softFrameX: 0.70,
    softFrameY: 0.72,
    hardFrameX: 0.88,
    hardFrameY: 0.90,
    yawTriggerHoldS: 0.16,
    maxYawRateDegS: 30,
    maxYawAccelDegS2: 90,
    maxDistanceRescueM: 5.5,
    maxFovRescueDeg: 10,
    maxFocusRescue: 0.16,
    rescueAttackS: 0.10,
    rescueReleaseS: 0.28,
  },
  B: {
    softFrameX: 0.72,
    softFrameY: 0.74,
    hardFrameX: 0.90,
    hardFrameY: 0.92,
    yawTriggerHoldS: 0.13,
    maxYawRateDegS: 45,
    maxYawAccelDegS2: 140,
    maxDistanceRescueM: 5,
    maxFovRescueDeg: 11,
    maxFocusRescue: 0.18,
    rescueAttackS: 0.08,
    rescueReleaseS: 0.24,
  },
  C: {
    softFrameX: 0.74,
    softFrameY: 0.76,
    hardFrameX: 0.92,
    hardFrameY: 0.94,
    yawTriggerHoldS: 0.10,
    maxYawRateDegS: 60,
    maxYawAccelDegS2: 220,
    maxDistanceRescueM: 4.5,
    maxFovRescueDeg: 12,
    maxFocusRescue: 0.20,
    rescueAttackS: 0.06,
    rescueReleaseS: 0.20,
  },
};

export interface CompositionPoint {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

export interface InertialCompositionDebug {
  readonly inertialAzimuthDeg: number;
  readonly yawVelocityDegS: number;
  readonly yawAccelerationDegS2: number;
  readonly rescuePressure: number;
  readonly softViolation: number;
  readonly hardViolation: number;
  readonly softViolationForS: number;
  readonly correctionActive: boolean;
  readonly firstScreen: CompositionPoint;
  readonly secondScreen: CompositionPoint;
  readonly totalYawTravelDeg: number;
  readonly yawReversals: number;
  readonly cinematicBlend: number;
}

export type InertialDirectorOutput = DirectorOutput & {
  readonly debug: DirectorOutput['debug'] & { readonly composition: InertialCompositionDebug };
};

interface CompositionMeasure {
  readonly first: CompositionPoint;
  readonly second: CompositionPoint;
  readonly softViolation: number;
  readonly hardViolation: number;
  readonly score: number;
  readonly offenderIsFirst: boolean;
}

export class InertialDuelDirector {
  private readonly base: CameraDirector;
  private readonly tuning: InertialCompositionTuning;
  private initialized = false;
  private azimuth = 0;
  private yawVelocity = 0;
  private previousYawVelocity = 0;
  private rescuePressure = 0;
  private softViolationFor = 0;
  private totalYawTravel = 0;
  private yawReversals = 0;
  private aspect: number;

  constructor(
    readonly preset: PresetId,
    private readonly params: CameraParams,
    aspect = 16 / 9,
    private readonly options: DirectorOptions = {},
    private readonly ringOutWatchRadiusM?: number,
  ) {
    this.base = new CameraDirector(params, aspect, options);
    this.tuning = INERTIAL_DUEL_TUNING[preset];
    this.aspect = aspect;
  }

  setAspect(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0.2) return;
    this.aspect = aspect;
    this.base.setAspect(aspect);
  }

  reset(): void {
    this.base.reset();
    this.initialized = false;
    this.azimuth = 0;
    this.yawVelocity = 0;
    this.previousYawVelocity = 0;
    this.rescuePressure = 0;
    this.softViolationFor = 0;
    this.totalYawTravel = 0;
    this.yawReversals = 0;
  }

  tick(frame: FightFrame, dt: number): InertialDirectorOutput {
    const cameraFrame = this.frameForArenaScale(frame);
    const raw = snapshot(this.base.tick(cameraFrame, dt));
    const tuning = this.tuning;

    const baseDistance = Math.max(0.1, Math.hypot(raw.eye.x - raw.focus.x, raw.eye.z - raw.focus.z));
    const baseHeight = raw.eye.y - raw.focus.y;

    if (!this.initialized) {
      this.azimuth = yawOf(raw.eye.x - raw.focus.x, raw.eye.z - raw.focus.z);
      this.initialized = true;
    }

    let focus = copy(raw.focus);
    let distance = baseDistance;
    let fov = raw.fov;
    let eye = this.guardEye(eyeAt(focus, this.azimuth, distance, baseHeight), focus, frame);
    let measure = compositionMeasure(frame, eye, focus, fov, this.aspect, tuning);

    // Hysteresis: crossing the soft frame builds optical rescue over a short
    // attack time, while returning inside releases more slowly. The result is
    // stable focus/distance/FOV near the boundary instead of per-tick pumping.
    const rescueTarget = clamp(measure.softViolation, 0, 1);
    const rescueTime = rescueTarget > this.rescuePressure ? tuning.rescueAttackS : tuning.rescueReleaseS;
    this.rescuePressure = smoothTowards(this.rescuePressure, rescueTarget, rescueTime, dt);
    const rescuePressure = this.rescuePressure;

    // First line of rescue: shift the focal point toward the subject that is
    // most endangered without changing the camera hemisphere.
    if (rescuePressure > 1e-4) {
      const offender = measure.offenderIsFirst ? frame.first.position : frame.second.position;
      const gain = tuning.maxFocusRescue * rescuePressure;
      focus = lerpVec(focus, offender, gain);
      eye = this.guardEye(eyeAt(focus, this.azimuth, distance, baseHeight), focus, frame);
      measure = compositionMeasure(frame, eye, focus, fov, this.aspect, tuning);
    }

    // Second line: use optical room before rotation. Fast pass-throughs can
    // therefore swap sides on screen without making the world follow them.
    if (rescuePressure > 1e-4) {
      distance += tuning.maxDistanceRescueM * rescuePressure;
      fov = Math.min(MAX_FOV_DEG, fov + tuning.maxFovRescueDeg * rescuePressure);
      eye = this.guardEye(eyeAt(focus, this.azimuth, distance, baseHeight + rescuePressure * 0.35), focus, frame);
      measure = compositionMeasure(frame, eye, focus, fov, this.aspect, tuning);
    }

    if (measure.softViolation > 0) this.softViolationFor += dt;
    else this.softViolationFor = 0;

    const cinematicBlend = clamp(Math.max(raw.weights.Clash, raw.weights.RingOut, raw.weights.Finisher), 0, 1);
    const cinematicOwnsShot = cinematicBlend >= CINEMATIC_TAKEOVER_THRESHOLD;
    const yawEligible = !cinematicOwnsShot && (measure.hardViolation > 0 || this.softViolationFor >= tuning.yawTriggerHoldS);

    let yawAcceleration = 0;
    if (cinematicOwnsShot) {
      // The special shot owns presentation. Freeze the remembered combat
      // hemisphere underneath it instead of silently rotating while hidden.
      this.yawVelocity = 0;
      this.previousYawVelocity = 0;
      this.softViolationFor = 0;
    } else {
      let desiredYawVelocity = 0;
      if (yawEligible) {
        const sample = YAW_SAMPLE_DEG * DEG;
        const leftScore = this.scoreAt(frame, focus, distance, baseHeight, fov, this.azimuth - sample);
        const rightScore = this.scoreAt(frame, focus, distance, baseHeight, fov, this.azimuth + sample);
        const direction = leftScore <= rightScore ? -1 : 1;
        const urgency = clamp(0.18 + measure.softViolation + measure.hardViolation * 1.5, 0, 1);
        desiredYawVelocity = direction * tuning.maxYawRateDegS * DEG * urgency;
      }

      const previousVelocity = this.yawVelocity;
      const maxVelocityDelta = tuning.maxYawAccelDegS2 * DEG * dt;
      this.yawVelocity += clamp(desiredYawVelocity - this.yawVelocity, -maxVelocityDelta, maxVelocityDelta);
      if (!yawEligible && Math.abs(this.yawVelocity) < 0.03 * DEG) this.yawVelocity = 0;
      yawAcceleration = dt > 0 ? (this.yawVelocity - previousVelocity) / dt : 0;

      if (
        Math.abs(this.previousYawVelocity) > 2 * DEG &&
        Math.abs(this.yawVelocity) > 2 * DEG &&
        Math.sign(this.previousYawVelocity) !== Math.sign(this.yawVelocity)
      ) {
        this.yawReversals++;
      }
      this.previousYawVelocity = this.yawVelocity;

      const yawStep = this.yawVelocity * dt;
      this.azimuth += yawStep;
      this.totalYawTravel += Math.abs(yawStep);
    }

    eye = this.guardEye(eyeAt(focus, this.azimuth, distance, baseHeight), focus, frame);
    measure = compositionMeasure(frame, eye, focus, fov, this.aspect, tuning);

    const modifiers = [...raw.debug.modifiers];
    if (rescuePressure > 0.01) modifiers.push(`composição: resgate óptico ${(rescuePressure * 100).toFixed(0)}%`);
    if (cinematicOwnsShot) modifiers.push('composição: azimute congelado sob câmera cinematográfica');
    else if (yawEligible) modifiers.push(`composição: yaw ${(this.yawVelocity / DEG).toFixed(1)}°/s`);
    else modifiers.push('composição: azimute estável');

    // Clash/Ring-Out/Finisher may take the shot. The combat azimuth is
    // preserved underneath and returns by blend, never re-derived from axisYaw.
    const shownEye = lerpVec(eye, raw.eye, cinematicBlend);
    const shownFocus = lerpVec(focus, raw.focus, cinematicBlend);
    const shownFov = lerp(fov, raw.fov, cinematicBlend);

    return {
      ...raw,
      eye: shownEye,
      focus: shownFocus,
      fov: shownFov,
      debug: {
        ...raw.debug,
        yawDeg: normalizeDeg(this.azimuth / DEG),
        modifiers,
        composition: {
          inertialAzimuthDeg: normalizeDeg(this.azimuth / DEG),
          yawVelocityDegS: this.yawVelocity / DEG,
          yawAccelerationDegS2: yawAcceleration / DEG,
          rescuePressure,
          softViolation: measure.softViolation,
          hardViolation: measure.hardViolation,
          softViolationForS: this.softViolationFor,
          correctionActive: yawEligible,
          firstScreen: measure.first,
          secondScreen: measure.second,
          totalYawTravelDeg: this.totalYawTravel / DEG,
          yawReversals: this.yawReversals,
          cinematicBlend,
        },
      },
    };
  }

  private scoreAt(frame: FightFrame, focus: Vec3, distance: number, height: number, fov: number, azimuth: number): number {
    const eye = this.guardEye(eyeAt(focus, azimuth, distance, height), focus, frame);
    return compositionMeasure(frame, eye, focus, fov, this.aspect, this.tuning).score;
  }

  /**
   * Reapply all final eye guards after composition has moved/rebuilt the shot.
   * The base director already protects its own output, but the wrapper must
   * not bypass floor/Bey clearance when it creates a different final eye.
   */
  private guardEye(eyeInput: Vec3, focus: Vec3, frame: FightFrame): Vec3 {
    let eye = this.contain(copy(eyeInput), focus);

    const floorY = this.options.floorHeightAt ? this.options.floorHeightAt(eye.x, eye.z) : 0;
    if (eye.y < floorY + this.params.floorClearance) eye.y = floorY + this.params.floorClearance;

    for (const fighter of [frame.first, frame.second]) {
      const dx = eye.x - fighter.position.x;
      const dz = eye.z - fighter.position.z;
      const horizontal = Math.hypot(dx, dz);
      if (horizontal >= this.params.beyClearance || eye.y - fighter.position.y >= this.params.beyClearance) continue;
      const len = horizontal || 1;
      const ux = horizontal > 1e-6 ? dx / len : Math.sin(this.azimuth);
      const uz = horizontal > 1e-6 ? dz / len : Math.cos(this.azimuth);
      eye.x = fighter.position.x + ux * this.params.beyClearance;
      eye.z = fighter.position.z + uz * this.params.beyClearance;
    }

    eye = this.contain(eye, focus);
    const finalFloorY = this.options.floorHeightAt ? this.options.floorHeightAt(eye.x, eye.z) : 0;
    if (eye.y < finalFloorY + this.params.floorClearance) eye.y = finalFloorY + this.params.floorClearance;
    return eye;
  }

  /** Keep the final, post-composition eye inside the arena. */
  private contain(eyeInput: Vec3, focus: Vec3): Vec3 {
    const radius = this.options.arena?.containRadiusM;
    if (!radius) return eyeInput;
    const eye = copy(eyeInput);
    const r = Math.hypot(eye.x, eye.z);
    if (r <= radius) return eye;
    const focusR = Math.hypot(focus.x, focus.z);
    if (focusR >= radius) {
      eye.x *= radius / r;
      eye.z *= radius / r;
      return eye;
    }
    const dx = eye.x - focus.x;
    const dz = eye.z - focus.z;
    const a = dx * dx + dz * dz;
    if (a <= 1e-9) return eye;
    const b = 2 * (focus.x * dx + focus.z * dz);
    const c = focus.x * focus.x + focus.z * focus.z - radius * radius;
    const disc = Math.max(0, b * b - 4 * a * c);
    const t = clamp((-b + Math.sqrt(disc)) / (2 * a), 0, 1);
    const lost = Math.sqrt(a) * (1 - t);
    eye.x = focus.x + dx * t;
    eye.z = focus.z + dz * t;
    eye.y += lost * 0.2;
    return eye;
  }

  /**
   * #88 compatibility without changing the approved Camera Lab director:
   * on the 3× stage an airborne Bey at r=10–30 m is still mid-arena, not a
   * ring-out candidate. `airborne` is used by the base director only for its
   * ring-out anticipation, so mask it until the arena-derived watch radius.
   * A declared ring-out is never masked.
   */
  private frameForArenaScale(frame: FightFrame): FightFrame {
    const watch = this.ringOutWatchRadiusM;
    if (!watch || frame.ringOutIsFirst !== null) return frame;
    const first = maskPrematureRingOut(frame.first, watch);
    const second = maskPrematureRingOut(frame.second, watch);
    if (first === frame.first && second === frame.second) return frame;
    return { ...frame, first, second };
  }
}

function maskPrematureRingOut(fighter: FighterFrame, watchRadiusM: number): FighterFrame {
  if (!fighter.airborne) return fighter;
  if (Math.hypot(fighter.position.x, fighter.position.z) >= watchRadiusM) return fighter;
  return { ...fighter, airborne: false };
}

function compositionMeasure(
  frame: FightFrame,
  eye: Vec3,
  focus: Vec3,
  fovDeg: number,
  aspect: number,
  tuning: InertialCompositionTuning,
): CompositionMeasure {
  const first = project(frame.first.position, eye, focus, fovDeg, aspect);
  const second = project(frame.second.position, eye, focus, fovDeg, aspect);
  const firstSoft = frameViolation(first, tuning.softFrameX, tuning.softFrameY);
  const secondSoft = frameViolation(second, tuning.softFrameX, tuning.softFrameY);
  const firstHard = frameViolation(first, tuning.hardFrameX, tuning.hardFrameY);
  const secondHard = frameViolation(second, tuning.hardFrameX, tuning.hardFrameY);
  const firstScore = frameScore(first, tuning.softFrameX, tuning.softFrameY);
  const secondScore = frameScore(second, tuning.softFrameX, tuning.softFrameY);
  return {
    first,
    second,
    softViolation: Math.max(firstSoft, secondSoft),
    hardViolation: Math.max(firstHard, secondHard),
    score: Math.max(firstScore, secondScore),
    offenderIsFirst: firstScore >= secondScore,
  };
}

function frameViolation(point: CompositionPoint, boundX: number, boundY: number): number {
  if (point.depth <= 0.2) return BEHIND_SCORE;
  return Math.max(0, Math.abs(point.x) / boundX - 1, Math.abs(point.y) / boundY - 1);
}

function frameScore(point: CompositionPoint, boundX: number, boundY: number): number {
  if (point.depth <= 0.2) return BEHIND_SCORE;
  return Math.max(Math.abs(point.x) / boundX, Math.abs(point.y) / boundY);
}

/** Project to normalized screen coordinates: ±1 is the actual viewport edge. */
export function project(point: Vec3, eye: Vec3, focus: Vec3, fovDeg: number, aspect: number): CompositionPoint {
  let fx = focus.x - eye.x;
  let fy = focus.y - eye.y;
  let fz = focus.z - eye.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;

  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;

  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;

  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  const depth = dx * fx + dy * fy + dz * fz;
  if (depth <= 0.2) return { x: Math.sign(dx * rx + dz * rz || 1) * BEHIND_SCORE, y: 0, depth };

  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const sx = (dx * rx + dz * rz) / depth;
  const sy = (dx * ux + dy * uy + dz * uz) / depth;
  return { x: sx / (tanV * aspect), y: sy / tanV, depth };
}

function eyeAt(focus: Vec3, azimuth: number, distance: number, height: number): Vec3 {
  return {
    x: focus.x + Math.sin(azimuth) * distance,
    y: focus.y + height,
    z: focus.z + Math.cos(azimuth) * distance,
  };
}

function copy(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function smoothTowards(current: number, target: number, timeConstantS: number, dt: number): number {
  if (dt <= 0 || timeConstantS <= 1e-6) return target;
  const alpha = 1 - Math.exp(-dt / timeConstantS);
  return lerp(current, target, alpha);
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function snapshot(output: DirectorOutput): DirectorOutput {
  return {
    ...output,
    eye: copy(output.eye),
    focus: copy(output.focus),
    shake: copy(output.shake),
    weights: { ...output.weights },
    debug: {
      ...output.debug,
      midpoint: copy(output.debug.midpoint),
      focusTarget: copy(output.debug.focusTarget),
      lookAheadPoint: copy(output.debug.lookAheadPoint),
      lookAheadVec: copy(output.debug.lookAheadVec),
      encounterPoint: output.debug.encounterPoint ? copy(output.debug.encounterPoint) : null,
      modifiers: [...output.debug.modifiers],
    },
  };
}
