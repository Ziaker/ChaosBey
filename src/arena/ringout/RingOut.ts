// ============================================================
// RING-OUT DETECTION
// See RingOutTuning.ts. Pure position check — round-rules decides what a
// ring-out actually does to match state (GDD section 1.4 separation).
// ============================================================

import { length, type Vec2 } from '../../physics/Vec2';
import { ARENA_FLOOR_RADIUS, ARENA_WALL_THICKNESS } from '../colliders/ArenaTuning';
import { RINGOUT_MARGIN_BEYOND_WALL_M } from './RingOutTuning';

export function isRingOut(positionXZ: Vec2): boolean {
  return length(positionXZ) > ARENA_FLOOR_RADIUS + ARENA_WALL_THICKNESS + RINGOUT_MARGIN_BEYOND_WALL_M;
}
