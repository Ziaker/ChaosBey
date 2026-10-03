// ============================================================
// RING-OUT DETECTION
// See RingOutTuning.ts. Pure position check — round-rules decides what a
// ring-out actually does to match state (GDD section 1.4 separation).
// ============================================================

import { length, type Vec2 } from '../../physics/Vec2';
import { ARENA_FLOOR_RADIUS } from '../colliders/ArenaTuning';
import { floorHeightAt, floorRimHeight, type ArenaFloorId } from '../floor/ArenaFloorProfile';
import { RING_OUT_FALLEN_BELOW_RIM_M, RINGOUT_RADIUS_M } from './RingOutTuning';

export function isRingOut(positionXZ: Vec2): boolean {
  return length(positionXZ) > RINGOUT_RADIUS_M;
}

/**
 * Outside the arena for the ring-out rule (owner, 2026-10-02): beyond the ring-out radius, or fallen off the arena —
 * more than RING_OUT_FALLEN_BELOW_RIM_M below the floor surface under it (the rim past the floor's edge). Seen with the
 * delay: a Bey thrown over the wall fell, slipped under the bowl and steered inward beneath it, falling forever inside
 * the ring-out radius. See RingOutTuning.ts.
 */
export function isOutOfArena(position: { x: number; y: number; z: number }, floor: ArenaFloorId): boolean {
  const r = Math.hypot(position.x, position.z);
  if (r > RINGOUT_RADIUS_M) return true;
  const surfaceY = r >= ARENA_FLOOR_RADIUS ? floorRimHeight(floor) : floorHeightAt(floor, position.x, position.z);
  return position.y < surfaceY - RING_OUT_FALLEN_BELOW_RIM_M;
}
