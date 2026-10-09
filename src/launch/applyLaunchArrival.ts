// ============================================================
// APPLY LAUNCH ARRIVAL — puts the two Beys where the launch left them
// The one place a LaunchResult touches the simulation: each Bey's body is set at the point of its first contact with the
// floor, moving the way it was launched, heading along its roll. Everything else (movement, spin, stamina, attack…) is
// untouched, so the match's first tick runs from exactly the state a launch-less match has at tick 0 apart from these poses.
// Used by the live session, the headless Self Test world and replay playback, so all three start a launched match the same
// way (design doc §9: "replayability of target + timing result").
// ============================================================

import type { Bey } from '../bey/core/Bey';
import { arenaFloorRadius } from '../arena/colliders/ArenaTuning';
import type { LaunchArena } from './LaunchGeometry';
import { launchArrivals, type LaunchArrival, type LaunchBeyShape, type LaunchResult } from './LaunchResult';
import type { LaunchSide } from './LaunchTuning';

/** The arena a match is played on, as the launch needs it: the match's floor profile and the current stage radius. */
export function launchArenaOf(floor: Bey['arenaFloor'], presetId?: string): LaunchArena {
  const floorRadiusM = arenaFloorRadius();
  // The Tournament Stadium has a deck between its wall and its stands: the launchers stand on it, outside the wall.
  return presetId === 'tournament' ? { floor, floorRadiusM, launcherRadiusM: floorRadiusM + STADIUM_LAUNCHER_OUTSIDE_WALL_M } : { floor, floorRadiusM };
}

/** From the wall to the launcher's centre on the Stadium's deck: the base (3.5 m deep, its front 2.3 m ahead of the centre) clears the wall. */
export const STADIUM_LAUNCHER_OUTSIDE_WALL_M = 2.6;

export function launchShapeOf(bey: Bey): LaunchBeyShape {
  return { colliderHalfHeightM: bey.definition.physical.colliderHalfHeightM, colliderRadiusM: bey.definition.physical.colliderRadiusM };
}

/** Where each Bey will arrive for this result, on this match's arena. */
export function arrivalsFor(first: Bey, second: Bey, result: LaunchResult): Record<LaunchSide, LaunchArrival> {
  return launchArrivals(result, launchArenaOf(first.arenaFloor), { first: launchShapeOf(first), second: launchShapeOf(second) });
}

/** Sets both Beys at their arrival. Only valid before the match's first tick. */
export function applyLaunchArrivals(first: Bey, second: Bey, result: LaunchResult): void {
  const arrivals = arrivalsFor(first, second, result);
  for (const [bey, arrival] of [[first, arrivals.first], [second, arrivals.second]] as const) {
    bey.body.setTranslation(arrival.position, true);
    bey.body.setLinvel(arrival.velocity, true);
    bey.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    bey.movement.setHeadingRad(arrival.headingRad);
  }
}
