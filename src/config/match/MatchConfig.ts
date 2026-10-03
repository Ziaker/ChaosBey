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
import { DASH_COOLDOWN_DEFAULT_S } from '../../combat/attacks/AttackTuning';
import {
  BODY_COLLISION_DAMAGE_DEFAULT,
  MOMENTUM_DECAY_DEFAULT_S,
  MOMENTUM_FILL_DEFAULT_S,
  MOMENTUM_GAIN_DEFAULT,
  MOMENTUM_LOSS_ON_COLLISION_DEFAULT,
} from '../../bey/momentum/MomentumTuning';
import { JUMP_FULL_HEIGHT_DEFAULT_M, JUMP_SHORT_HOP_TARGET_APEX_M } from '../../drift/DriftTuning';

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
  /**
   * Owner, 2026-10-02: seconds after a Dash ends before the next one can start charging, for player and AI alike (the
   * Dash no longer spends Attack Energy). PROVISIONAL default 1.5 s. Pregame slider.
   */
  dashCooldownS: number;
  /** Owner, 2026-10-02 (Lote 3): top speed = maxSpeed × (1 + momentum × this). +100% (1.0). Pregame slider. */
  momentumGain: number;
  /** Seconds of sustained fast movement to fill momentum. 4 s. Pregame slider. */
  momentumFillS: number;
  /** Seconds for full momentum to drain. 2 s. Pregame slider. */
  momentumDecayS: number;
  /** Body collision Stability damage, ×1 = a Circular Attack's at a 10 m/s speed difference. PROVISIONAL. Pregame slider. */
  bodyCollisionDamage: number;
  /** Fraction of momentum lost by the faster Bey in a body collision (and on a hit taken or a wall impact). PROVISIONAL 0.5. Pregame slider. */
  momentumLossOnCollision: number;
  /** Owner, 2026-10-02 (Lote 4): apex of a full (held) jump, m; the launch speed is derived from it. PROVISIONAL 2.5 m. Pregame slider. */
  jumpFullHeightM: number;
  /** Apex of a short hop (a tap), m. Default the previous value (~0.13 m). Pregame slider. */
  jumpShortHopHeightM: number;
}

/** The per-Bey gameplay rules of a match: what createBey() needs from MatchConfig. */
export type BeyMatchRules = Pick<MatchConfig, 'dashCooldownS' | 'momentumGain' | 'momentumFillS' | 'momentumDecayS' | 'bodyCollisionDamage' | 'momentumLossOnCollision' | 'jumpFullHeightM' | 'jumpShortHopHeightM'>;

export function beyMatchRulesOf(config: MatchConfig): BeyMatchRules {
  return {
    dashCooldownS: config.dashCooldownS,
    momentumGain: config.momentumGain,
    momentumFillS: config.momentumFillS,
    momentumDecayS: config.momentumDecayS,
    bodyCollisionDamage: config.bodyCollisionDamage,
    momentumLossOnCollision: config.momentumLossOnCollision,
    jumpFullHeightM: config.jumpFullHeightM,
    jumpShortHopHeightM: config.jumpShortHopHeightM,
  };
}

export function createDefaultMatchConfig(): MatchConfig {
  return {
    clashImpactMultiplier: CLASH_IMPACT_MULTIPLIER_DEFAULT,
    arenaWallHeightM: STANDARD_ARENA_GEOMETRY.wallHeightM,
    arenaWallRestitution: STANDARD_ARENA_GEOMETRY.wallRestitution,
    arenaFloor: DEFAULT_ARENA_FLOOR,
    motion: DEFAULT_MOTION_DIRECTION,
    ringOutDelayS: RING_OUT_DELAY_DEFAULT_S,
    dashCooldownS: DASH_COOLDOWN_DEFAULT_S,
    momentumGain: MOMENTUM_GAIN_DEFAULT,
    momentumFillS: MOMENTUM_FILL_DEFAULT_S,
    momentumDecayS: MOMENTUM_DECAY_DEFAULT_S,
    bodyCollisionDamage: BODY_COLLISION_DAMAGE_DEFAULT,
    momentumLossOnCollision: MOMENTUM_LOSS_ON_COLLISION_DEFAULT,
    jumpFullHeightM: JUMP_FULL_HEIGHT_DEFAULT_M,
    jumpShortHopHeightM: JUMP_SHORT_HOP_TARGET_APEX_M,
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
