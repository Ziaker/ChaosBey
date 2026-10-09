// ============================================================
// LAUNCH GEOMETRY — where the launchers stand, where a Bey may land, how it flies
// Pure maths on the match's own floor profile (no Three.js, no physics): the entry point is validated against the real
// arena (design doc §4, §9: "current arena/floor geometry when validating target points"), and the flight is the
// prototype's (updateFlight): a smoothstep along the line from the socket to the entry point plus a sine arc.
// ============================================================

import { floorHeightAt, type ArenaFloor } from '../arena/floor/ArenaFloorProfile';
import { LAUNCH_TUNING, launchOutcomeFor, type LaunchSide } from './LaunchTuning';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface GroundPoint {
  x: number;
  z: number;
}

/** What the geometry needs to know about the match's arena. */
export interface LaunchArena {
  readonly floor: ArenaFloor;
  /** The floor radius of this match (m): 36 m × the stage size. */
  readonly floorRadiusM: number;
}

/** Unit vector from a side's launcher toward the arena's centre. `first` stands at −z (the opening axis of the game), `second` at +z. */
export function launcherForward(side: LaunchSide): GroundPoint {
  return side === 'first' ? { x: 0, z: 1 } : { x: 0, z: -1 };
}

/** The launcher's right-hand side on a screen that looks along its forward axis (right is the clockwise quarter turn of forward, as in screenToWorld). */
export function launcherRight(side: LaunchSide): GroundPoint {
  const f = launcherForward(side);
  return { x: -f.z, z: f.x };
}

/** The foot of a side's launcher, on the floor. */
export function launcherBase(side: LaunchSide, arena: LaunchArena): Vec3 {
  const z = (side === 'first' ? -1 : 1) * arena.floorRadiusM * LAUNCH_TUNING.launcherRadiusShare;
  return { x: 0, y: floorHeightAt(arena.floor, 0, z) + LAUNCH_TUNING.launcherBaseLiftM, z };
}

/** The yaw (radians, atan2(x, z)) that makes a launcher face an entry point. */
export function launcherYaw(side: LaunchSide, arena: LaunchArena, target: GroundPoint): number {
  const base = launcherBase(side, arena);
  const dx = target.x - base.x;
  const dz = target.z - base.z;
  if (Math.hypot(dx, dz) < 1e-6) return Math.atan2(launcherForward(side).x, launcherForward(side).z);
  return Math.atan2(dx, dz);
}

/** Where the Bey sits while mounted: the launcher's socket, turned toward the entry point. */
export function socketPosition(side: LaunchSide, arena: LaunchArena, target: GroundPoint): Vec3 {
  const base = launcherBase(side, arena);
  const yaw = launcherYaw(side, arena, target);
  const s = LAUNCH_TUNING.socketLocalM;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // Local +z is the launcher's forward (toward the target), local +x its right-hand side seen from behind.
  return { x: base.x + s.x * cos + s.z * sin, y: base.y + s.y, z: base.z - s.x * sin + s.z * cos };
}

/** Pulls an entry point back inside the valid landing area (a circle around the centre); non-finite input falls back to the default. */
export function clampLaunchTarget(target: GroundPoint, arena: LaunchArena, side: LaunchSide): GroundPoint {
  const max = arena.floorRadiusM * LAUNCH_TUNING.targetMaxRadiusShare;
  let { x, z } = target;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return defaultLaunchTarget(side, arena);
  const r = Math.hypot(x, z);
  if (r > max) {
    x = (x / r) * max;
    z = (z / r) * max;
  }
  return { x, z };
}

/** The entry point a side starts with: a little in front of its launcher, on its own half. */
export function defaultLaunchTarget(side: LaunchSide, arena: LaunchArena): GroundPoint {
  const f = launcherForward(side);
  const d = arena.floorRadiusM * LAUNCH_TUNING.targetDefaultShare;
  return { x: -f.x * d, z: -f.z * d };
}

/** The direction a Bey rolls in on arrival: toward the arena's centre (the prototype's carry), or straight out of its launcher when it lands on the centre. */
export function arrivalDirection(side: LaunchSide, target: GroundPoint): GroundPoint {
  const r = Math.hypot(target.x, target.z);
  if (r < 1) return launcherForward(side);
  return { x: -target.x / r, z: -target.z / r };
}

/**
 * Keeps two landings apart: when they are closer than the minimum, `yielding` is pushed away from the other along the line
 * between them (and kept inside the area), so two Beys never arrive on the same spot.
 */
export function separateTargets(fixed: GroundPoint, yielding: GroundPoint, minDistanceM: number, arena: LaunchArena, yieldingSide: LaunchSide): GroundPoint {
  const dx = yielding.x - fixed.x;
  const dz = yielding.z - fixed.z;
  const d = Math.hypot(dx, dz);
  if (d >= minDistanceM) return yielding;
  // On top of each other: go along the yielding side's own axis, away from its launcher's forward.
  const dir = d > 1e-6 ? { x: dx / d, z: dz / d } : { x: -launcherForward(yieldingSide).x, z: -launcherForward(yieldingSide).z };
  const pushed = { x: fixed.x + dir.x * minDistanceM, z: fixed.z + dir.z * minDistanceM };
  const clamped = clampLaunchTarget(pushed, arena, yieldingSide);
  if (Math.hypot(clamped.x - fixed.x, clamped.z - fixed.z) >= minDistanceM - 1e-6) return clamped;
  // Pushed against the edge: slide the other way round the circle instead.
  const back = { x: fixed.x - dir.x * minDistanceM, z: fixed.z - dir.z * minDistanceM };
  return clampLaunchTarget(back, arena, yieldingSide);
}

const smoothstep01 = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

export interface FlightPlan {
  readonly start: Vec3;
  readonly end: Vec3;
  /** Seconds in the air. */
  readonly durationS: number;
  /** Peak of the arc over the straight line (m). */
  readonly arcM: number;
  /** Sideways lean of the Bey on the way (rad, visual). */
  readonly leanRad: number;
}

/** The flight of one side from its socket to its landing. */
export function flightPlan(side: LaunchSide, start: Vec3, end: Vec3, quality: number): FlightPlan {
  const outcome = launchOutcomeFor(quality);
  const t = LAUNCH_TUNING;
  return {
    start,
    end,
    durationS: outcome.flightS,
    arcM: side === 'first' ? t.arcBaseM + outcome.power * t.arcPowerGainM : t.arcOtherSideM,
    leanRad: side === 'first' ? 0.12 + outcome.power * 0.13 : -0.16,
  };
}

/** Position and lean `elapsedS` seconds after this Bey left (0 = at the socket, durationS = landed). */
export function flightPose(plan: FlightPlan, elapsedS: number): { position: Vec3; progress: number; leanRad: number } {
  const p = Math.max(0, Math.min(1, elapsedS / plan.durationS));
  const e = smoothstep01(p);
  const arc = Math.sin(Math.PI * p) * plan.arcM;
  return {
    position: {
      x: plan.start.x + (plan.end.x - plan.start.x) * e,
      y: plan.start.y + (plan.end.y - plan.start.y) * e + arc,
      z: plan.start.z + (plan.end.z - plan.start.z) * e,
    },
    progress: p,
    leanRad: Math.sin(Math.PI * p) * plan.leanRad,
  };
}

/** The point of the arc of a planned flight, for drawing the dashed guide before the launch (prototype: updateTargetPresentation). */
export function arcPoints(start: Vec3, end: Vec3, arcM: number, segments = 24): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t + Math.sin(Math.PI * t) * arcM, z: start.z + (end.z - start.z) * t });
  }
  return points;
}
