// ============================================================
// LAUNCH RESULT — what the Launch System hands to the match
// The interactive part of a launch (the player moving the entry point, the marker, the press) happens before the fight and
// is real time; what the fight needs from it is two numbers per side — WHERE the Bey enters and HOW WELL it was timed.
// Design doc §9: "replayability of target + timing result". This record is exactly that: it goes into the replay config, and
// from it alone the arrival of both Beys (position, speed, heading) is computed, the same way live, headless and in a replay.
// ============================================================

import { floorHeightAt } from '../arena/floor/ArenaFloorProfile';
import { arrivalDirection, clampLaunchTarget, separateTargets, type GroundPoint, type LaunchArena, type Vec3 } from './LaunchGeometry';
import { LAUNCH_SIDES, LAUNCH_TUNING, launchOutcomeFor, type LaunchOutcome, type LaunchSide } from './LaunchTuning';

/** One side's launch: the entry point it chose and how well it timed the release (0..1). */
export interface LaunchSideResult {
  readonly target: GroundPoint;
  readonly quality: number;
}

export interface LaunchResult {
  readonly first: LaunchSideResult;
  readonly second: LaunchSideResult;
}

/** Where a Bey stands, how fast it moves and which way it faces the instant its first contact with the arena is made. */
export interface LaunchArrival {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly headingRad: number;
  readonly outcome: LaunchOutcome;
}

/** The part of a Bey the landing needs: how tall it stands on the floor. */
export interface LaunchBeyShape {
  readonly colliderHalfHeightM: number;
  /** The Bey's collider radius (m): two landings are kept at least this far apart (× the tuning's minimum in diameters). */
  readonly colliderRadiusM: number;
}

/** Entry points after the arena's own rules: inside the landing area, and the two apart. `yielding` is the side whose point moves. */
export function validTargets(result: LaunchResult, arena: LaunchArena, beys: Record<LaunchSide, LaunchBeyShape>, yielding: LaunchSide = 'second'): Record<LaunchSide, GroundPoint> {
  const first = clampLaunchTarget(result.first.target, arena, 'first');
  const second = clampLaunchTarget(result.second.target, arena, 'second');
  const minDistance = LAUNCH_TUNING.minLandingSeparationBeyDiameters * 2 * Math.max(beys.first.colliderRadiusM, beys.second.colliderRadiusM);
  if (yielding === 'second') return { first, second: separateTargets(first, second, minDistance, arena, 'second') };
  return { first: separateTargets(second, first, minDistance, arena, 'first'), second };
}

/** The arrival of one side — a pure function of the recorded result and the arena (design doc §9). */
export function launchArrivals(result: LaunchResult, arena: LaunchArena, beys: Record<LaunchSide, LaunchBeyShape>, yielding: LaunchSide = 'second'): Record<LaunchSide, LaunchArrival> {
  const targets = validTargets(result, arena, beys, yielding);
  const out = {} as Record<LaunchSide, LaunchArrival>;
  for (const side of LAUNCH_SIDES) {
    const t = targets[side];
    const outcome = launchOutcomeFor(result[side].quality);
    const dir = arrivalDirection(side, t);
    // The Bey touches the floor exactly: its resting height over the floor's own height at that point (design doc §2: Combat
    // starts when the first contact is made, with no fixed delay; the contact itself is a small bounce handled by the physics).
    const y = floorHeightAt(arena.floor, t.x, t.z) + beys[side].colliderHalfHeightM;
    out[side] = {
      position: { x: t.x, y, z: t.z },
      velocity: { x: dir.x * outcome.entrySpeedMps, y: LAUNCH_TUNING.arrivalBounceMps, z: dir.z * outcome.entrySpeedMps },
      headingRad: Math.atan2(dir.x, dir.z),
      outcome,
    };
  }
  return out;
}

/** A result is plain data: what a replay holds is checked before it is used. Returns null when it is not a launch result. */
export function parseLaunchResult(value: unknown): LaunchResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const side = (v: unknown): LaunchSideResult | null => {
    if (typeof v !== 'object' || v === null) return null;
    const s = v as Record<string, unknown>;
    const target = s.target as Record<string, unknown> | undefined;
    if (!target || typeof target.x !== 'number' || typeof target.z !== 'number' || typeof s.quality !== 'number') return null;
    if (!Number.isFinite(target.x) || !Number.isFinite(target.z) || !Number.isFinite(s.quality)) return null;
    return { target: { x: target.x, z: target.z }, quality: Math.max(0, Math.min(1, s.quality)) };
  };
  const first = side(record.first);
  const second = side(record.second);
  return first && second ? { first, second } : null;
}
