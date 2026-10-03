// ============================================================
// MATCH CONFIG
// Single resolved source of truth for pre-match-configurable gameplay
// numbers (GDD section 101/166: avoid competing sources of truth) — the
// per-match counterpart to config/runtime/RuntimeConfig.ts, which only
// covers app-boot settings. Each system that owns a configurable value
// reads its own field here rather than a tuning constant directly, so a
// pre-match override always takes effect through exactly one path.
//
// Milestone 5 is the first consumer: the GDD requires Clash's knockback
// impact multiplier to be configurable pre-match (section 152), not a
// fixed constant. Other systems can add their own fields here later the
// same way, without inventing a second config mechanism.
// ============================================================

import { CLASH_IMPACT_MULTIPLIER_DEFAULT } from '../../combat/clash/ClashTuning';
import { DEFAULT_ARENA_FLOOR, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import { STANDARD_ARENA_GEOMETRY, type ArenaGeometry } from '../../arena/presets/ArenaPresets';
import { DEFAULT_MOTION_DIRECTION, type MotionDirectionId } from '../../bey/motion/MotionPresets';
import { RING_OUT_DELAY_DEFAULT_S } from '../../arena/ringout/RingOutTuning';

export interface MatchConfig {
  /** Multiplies the real knockback/Stability consequence a Clash resolution applies (both the FirstWins/SecondWins loser's knockback and a Tie's symmetric repulsion) — GDD section 152's "configurable impact multiplier". */
  clashImpactMultiplier: number;
  /** Height of the arena's boundary wall (m). M10 arena slider (GDD 36); a lower wall lets a launched Bey fly out. */
  arenaWallHeightM: number;
  /** Restitution of the boundary wall's colliders. M10 arena slider (GDD 36): how hard a wall hit bounces back. */
  arenaWallRestitution: number;
  /**
   * M11 lane 4: the floor's profile — flat (the current arena, default) or
   * one of the approved bowls A/B/C, for playtest (arena/floor/). Gameplay:
   * it builds the floor collider, so it is recorded in every replay.
   * Replays recorded before this field existed were all flat.
   */
  arenaFloor: ArenaFloorId;
  /**
   * M11: the motion direction — the approved Motion Lab preset A (Stable
   * Arcade), B (Physical Hybrid, default) or C (Wild Mechanical), see
   * bey/motion/MotionPresets.ts. Gameplay: both Beys and the arena's
   * bounce use it, so it is recorded in every replay.
   */
  motion: MotionDirectionId;
  /**
   * Owner, 2026-10-02: seconds a Bey must stay outside the ring-out radius before the ring-out counts (back inside
   * resets it). PROVISIONAL default 1.5 s; 0 = the old instant rule. Pregame slider.
   */
  ringOutDelayS: number;
}

export function createDefaultMatchConfig(): MatchConfig {
  return {
    clashImpactMultiplier: CLASH_IMPACT_MULTIPLIER_DEFAULT,
    arenaWallHeightM: STANDARD_ARENA_GEOMETRY.wallHeightM,
    arenaWallRestitution: STANDARD_ARENA_GEOMETRY.wallRestitution,
    arenaFloor: DEFAULT_ARENA_FLOOR,
    motion: DEFAULT_MOTION_DIRECTION,
    ringOutDelayS: RING_OUT_DELAY_DEFAULT_S,
  };
}

/** Merges a pre-match override on top of the defaults, producing the single resolved MatchConfig the rest of the app consumes. */
export function resolveMatchConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return { ...createDefaultMatchConfig(), ...overrides };
}

/** The arena values of a resolved config, in the shape the arena builder takes. */
export function arenaGeometryOf(config: MatchConfig): ArenaGeometry {
  // A config without a floor predates floors: flat (as MatchSession and replay playback read it too).
  return { wallHeightM: config.arenaWallHeightM, wallRestitution: config.arenaWallRestitution, floor: config.arenaFloor ?? 'flat' };
}
