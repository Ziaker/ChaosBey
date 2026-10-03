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
import { BOWL_DEPTH_M, DEFAULT_ARENA_FLOOR, type ArenaFloor, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
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
import { MOVEMENT_STAMINA_DRAIN_DEFAULT } from '../../bey/stamina/StaminaTuning';
import { DODGE_COOLDOWN_S } from '../../dodge/DodgeTuning';
import { CIRCULAR_LAUNCH_FORCE_DEFAULT } from '../../combat/attacks/AttackTuning';

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
  /** Owner, 2026-10-02 (Lote 5): scales the movement (speed) Stamina drain; 1 = the new 2.1/s at full speed (was 3). Pregame slider 0-200%. */
  movementStaminaDrain: number;
  /** Seconds between dodges (GDD section 12 "pre-game configurable"). 3 s. Pregame slider. */
  dodgeCooldownS: number;
  /** Owner, 2026-10-02 (Lote 5): how hard an active Circular launches whoever touches it (×1 = the provisional default). Pregame slider. */
  circularLaunchForce: number;
  // Owner, 2026-10-02 (Lote 9, items 3/20 — GDD 12). PROVISIONAL defaults = the game as it was.
  /** Bowl depth / funnel (m): the rim's height above the centre for bowls A/B/C (0 = flat). */
  arenaBowlDepthM: number;
  /** Round time limit (s); 0 = no timer. Running out with nobody beaten = Draw. */
  roundTimeLimitS: number;
  winByKo: boolean;
  winByRingOut: boolean;
  winBySpinOut: boolean;
  /** Multipliers on every Bey's acceleration, top speed and in-air steering grip (1 = as designed). */
  accelerationScale: number;
  topSpeedScale: number;
  airControl: number;
  /** Stamina a hop/jump costs (0 = free); a Bey without that much can't jump. */
  jumpStaminaCost: number;
  /** Seconds after a hop/jump begins before the next can (0 = none). */
  jumpCooldownS: number;
  /**
   * Owner, 2026-10-02 (item 13): the Circular is defensive (its user takes nothing; whoever touches it is launched).
   * Always on in a match; false only for bare constructions (createBey without match rules: the Camera Lab), which
   * keep the pre-2026-10-02 Circular like their jump and ring-out. Not a Pregame option.
   */
  defensiveCircular: boolean;
}

/** The per-Bey gameplay rules of a match: what createBey() needs from MatchConfig. */
export type BeyMatchRules = Pick<MatchConfig, 'dashCooldownS' | 'momentumGain' | 'momentumFillS' | 'momentumDecayS' | 'bodyCollisionDamage' | 'momentumLossOnCollision' | 'jumpFullHeightM' | 'jumpShortHopHeightM' | 'movementStaminaDrain' | 'dodgeCooldownS' | 'circularLaunchForce' | 'accelerationScale' | 'topSpeedScale' | 'airControl' | 'jumpStaminaCost' | 'jumpCooldownS' | 'defensiveCircular'>;

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
    movementStaminaDrain: config.movementStaminaDrain,
    dodgeCooldownS: config.dodgeCooldownS,
    circularLaunchForce: config.circularLaunchForce,
    accelerationScale: config.accelerationScale,
    topSpeedScale: config.topSpeedScale,
    airControl: config.airControl,
    jumpStaminaCost: config.jumpStaminaCost,
    jumpCooldownS: config.jumpCooldownS,
    defensiveCircular: config.defensiveCircular ?? true,
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
    movementStaminaDrain: MOVEMENT_STAMINA_DRAIN_DEFAULT,
    dodgeCooldownS: DODGE_COOLDOWN_S,
    circularLaunchForce: CIRCULAR_LAUNCH_FORCE_DEFAULT,
    arenaBowlDepthM: BOWL_DEPTH_M,
    roundTimeLimitS: 0,
    winByKo: true,
    winByRingOut: true,
    winBySpinOut: true,
    accelerationScale: 1,
    topSpeedScale: 1,
    airControl: 1,
    jumpStaminaCost: 0,
    jumpCooldownS: 0,
    defensiveCircular: true,
  };
}

/** Merges a pre-match override on top of the defaults, producing the single resolved MatchConfig the rest of the app consumes. */
export function resolveMatchConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return { ...createDefaultMatchConfig(), ...overrides };
}

/** The arena values of a resolved config, in the shape the arena builder takes. */
export function arenaGeometryOf(config: MatchConfig): ArenaGeometry {
  // A config without a floor predates floors: flat (as MatchSession and replay playback read it too).
  return { wallHeightM: config.arenaWallHeightM, wallRestitution: config.arenaWallRestitution, floor: config.arenaFloor ?? 'flat', floorDepthM: config.arenaBowlDepthM ?? BOWL_DEPTH_M };
}

/** Slider ranges for the Lote 9 rules (owner, 2026-10-02). PROVISIONAL except the required acceleration reach from the Master Design. */
export const ARENA_BOWL_DEPTH_RANGE = { min: 0, max: 5, step: 0.25 } as const;
export const ROUND_TIME_LIMIT_RANGE = { min: 0, max: 180, step: 15 } as const;
/** Master Design §12: acceleration playtesting must reach roughly 3 s time-to-speed. The default Bey is ~11 m/s / 14 m/s² ≈ 0.79 s; ×0.25 reaches ~3.1 s. */
export const ACCELERATION_SCALE_RANGE = { min: 0.25, max: 2, step: 0.05 } as const;
export const TOP_SPEED_SCALE_RANGE = { min: 0.5, max: 1.5, step: 0.05 } as const;
export const AIR_CONTROL_RANGE = { min: 0, max: 3, step: 0.1 } as const;
export const JUMP_STAMINA_COST_RANGE = { min: 0, max: 20, step: 1 } as const;
export const JUMP_COOLDOWN_RANGE = { min: 0, max: 3, step: 0.1 } as const;

/** The match's floor: its profile and depth (Lote 9, item 3), the one value every floor reader takes. */
export function arenaFloorOf(config: MatchConfig): ArenaFloor {
  return { id: config.arenaFloor ?? 'flat', depthM: config.arenaBowlDepthM ?? BOWL_DEPTH_M };
}

/** RoundState's options from the match config (ring-out delay, time limit, win conditions — Lote 9). */
export function roundStateOptionsOf(config: MatchConfig): { ringOutDelayS: number; timeLimitS: number; winConditions: { ko: boolean; ringOut: boolean; spinOut: boolean } } {
  return {
    ringOutDelayS: config.ringOutDelayS,
    timeLimitS: config.roundTimeLimitS ?? 0,
    winConditions: { ko: config.winByKo ?? true, ringOut: config.winByRingOut ?? true, spinOut: config.winBySpinOut ?? true },
  };
}
