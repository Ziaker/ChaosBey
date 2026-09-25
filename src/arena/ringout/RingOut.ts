// ============================================================
// RING-OUT DETECTION
// See RingOutTuning.ts. Pure position check — round-rules decides what a
// ring-out actually does to match state (GDD section 1.4 separation).
// ============================================================

import { length, type Vec2 } from '../../physics/Vec2';
import { RINGOUT_RADIUS_M } from './RingOutTuning';

export function isRingOut(positionXZ: Vec2): boolean {
  return length(positionXZ) > RINGOUT_RADIUS_M;
}
