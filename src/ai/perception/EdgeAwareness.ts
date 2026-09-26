// ============================================================
// EDGE / RING-OUT AWARENESS (MILESTONE 7)
// GDD section 129: "Both player feedback and AI should understand danger
// near the boundary ... AI should know when it is at risk, attempt
// recovery, pressure opponents near edge. Do not give AI hidden teleport
// recovery." Pure geometry helpers reusing the exact same RINGOUT_RADIUS_M
// the real isRingOut() check uses (src/arena/ringout/), so the AI's notion
// of "how close to the edge" can never silently drift from the actual rule
// — and reusing Vec2 (GDD section 1.4: no duplicate math utilities).
// ============================================================

import { length, normalize, scale, type Vec2 } from '../../physics/Vec2';
import { RINGOUT_RADIUS_M } from '../../arena/ringout/RingOutTuning';

/** Remaining distance (m) to the ring-out boundary along the straight line from the arena center; negative once already past it. */
export function distanceToEdgeM(positionXZ: Vec2): number {
  return RINGOUT_RADIUS_M - length(positionXZ);
}

/** Unit vector pointing from `positionXZ` back toward the arena center (0,0); the zero vector only when already exactly at the center. */
export function directionTowardCenter(positionXZ: Vec2): Vec2 {
  return normalize(scale(positionXZ, -1));
}

/**
 * 0..1 danger fraction: 0 at/near the center, approaching 1 right at the
 * boundary, and clamped at 1 beyond it (never reports "more than maximum
 * danger" just because a Bey is further out of bounds — a ring-out at that
 * point is already an outcome, not an escalating risk to react to).
 * `marginM` sets how far from the boundary the risk starts ramping up
 * (a purely reactive "danger only once basically at the wall" AI would
 * fail GDD section 129's "attempt recovery" requirement, since by the time
 * distanceToEdgeM hits ~0 there is often no time left to react).
 */
export function edgeRiskFraction(positionXZ: Vec2, marginM: number): number {
  if (marginM <= 0) return 0;
  const remaining = distanceToEdgeM(positionXZ);
  if (remaining <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - remaining / marginM));
}
