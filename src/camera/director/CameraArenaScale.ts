// ============================================================
// CAMERA ARENA SCALE — PRESENTATION-ONLY TUNING
// Derived from gameplay arena constants so camera framing follows stage size.
// These values may move the camera only; they must never alter gameplay.
// ============================================================

import { ARENA_FLOOR_RADIUS } from '../../arena/colliders/ArenaTuning';
import { RINGOUT_RADIUS_M } from '../../arena/ringout/RingOutTuning';

/** Distance kept between the camera eye and the rendered wall/floor edge. */
export const CAMERA_EDGE_MARGIN_M = 1.5;

/** Maximum radial position of the normal in-game camera eye. */
export const CAMERA_CONTAIN_RADIUS_M = ARENA_FLOOR_RADIUS - CAMERA_EDGE_MARGIN_M;

/**
 * Presentation anticipation for a likely ring-out. The original arena used
 * 9 m against a 12.9 m gameplay ring-out radius, so preserve the same
 * 3.9 m inset on the 3× arena instead of firing the cinematic at mid-stage.
 */
export const CAMERA_RINGOUT_WATCH_INSET_M = 3.9;
export const CAMERA_RINGOUT_WATCH_RADIUS_M = RINGOUT_RADIUS_M - CAMERA_RINGOUT_WATCH_INSET_M;
