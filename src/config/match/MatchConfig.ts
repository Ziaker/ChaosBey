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
import { CIRCULAR_LAUNCH_FORCE_DEFAULT, DASH_COOLDOWN_DEFAULT_S } from '../../combat/attacks/AttackTuning';
import { SPEED_DAMAGE_GAIN_DEFAULT } from '../../combat/attacks/SpeedDamage';
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

export interface MatchConfig {
  /** Multiplies the real knockback/Stability consequence a Clash resolution applies. */
  clashImpactMultiplier: number;
  /** Height of the arena's boundary wall (m). */
  arenaWallHeightM: number;
  /** Restitution of the boundary wall's colliders. */
  arenaWallRestitution: number;
  /** Floor profile; gameplay, therefore recorded in replays. */
  arenaFloor: ArenaFloorId;
  /** Approved Motion Lab direction; gameplay, therefore recorded in replays. */
  motion: MotionDirectionId;
  /** Seconds continuously outside the ring-out radius before ring-out counts. */
  ringOutDelayS: number;
  /** Seconds after a Dash ends before the next can start charging. */
  dashCooldownS: number;
  /** Top speed = maxSpeed × (1 + momentum × this). */
  momentumGain: number;
  /** Seconds of sustained fast movement to fill momentum. */
  momentumFillS: number;
  /** Seconds for full momentum to drain. */
  momentumDecayS: number;
  /** Body-collision Stability-damage scale. */
  bodyCollisionDamage: number;
  /** Fraction of momentum lost by the faster Bey on collision/hit/wall impact. */
  momentumLossOnCollision: number;
  /** Apex of a full jump, metres. */
  jumpFullHeightM: number;
  /** Apex of a short hop, metres. */
  jumpShortHopHeightM: number;
  /** Movement Stamina-drain multiplier. */
  movementStaminaDrain: number;
  /** Seconds between dodges. */
  dodgeCooldownS: number;
  /** Active Circular launch-force multiplier. */
  circularLaunchForce: number;
  /** Bowl depth / funnel (m): rim height above centre for bowls A/B/C. */
  arenaBowlDepthM: number;
  /** Round time limit; 0 = no timer. */
  roundTimeLimitS: number;
  winByKo: boolean;
  winByRingOut: boolean;
  winBySpinOut: boolean;
  /** Multipliers on acceleration, top speed and in-air steering grip. */
  accelerationScale: number;
  topSpeedScale: number;
  /**
   * Master §12 speed-limit playtest. False = permissive physical overspeed; true = hard-cap ordinary grounded
   * locomotion while leaving Dash, Dodge, airborne flight and live post-impact impulses alone.
   */
  strictSpeedCap: boolean;
  airControl: number;
  /** Stamina a hop/jump costs. */
  jumpStaminaCost: number;
  /** Seconds after a hop/jump begins before the next can. */
  jumpCooldownS: number;
  /**
   * Owner item 13: the Circular is defensive. Kept in the shape for replay compatibility, but every resolved real match
   * forces true; only bare prototype/Camera-Lab createBey constructions may use false.
   */
  defensiveCircular: boolean;
  /**
   * Owner, 2026-10-04 (item 11): how strongly attack Stability damage follows the attacker's speed at contact.
   * 0 = off. PROVISIONAL default 0.5; see combat/attacks/SpeedDamage.ts.
   */
  speedDamageGain: number;
  /** Item 11: a Dash never runs slower than the speed already built before it fired. PROVISIONAL default on. */
  dashCarriesSpeed: boolean;
}

/** The per-Bey gameplay rules of a match: what createBey() needs from MatchConfig. */
export type BeyMatchRules = Pick<
  MatchConfig,
  'dashCooldownS' | 'momentumGain' | 'momentumFillS' | 'momentumDecayS' | 'bodyCollisionDamage' | 'momentumLossOnCollision'
  | 'jumpFullHeightM' | 'jumpShortHopHeightM' | 'movementStaminaDrain' | 'dodgeCooldownS' | 'circularLaunchForce'
  | 'accelerationScale' | 'topSpeedScale' | 'strictSpeedCap' | 'airControl' | 'jumpStaminaCost' | 'jumpCooldownS'
  | 'defensiveCircular' | 'speedDamageGain' | 'dashCarriesSpeed'
>;

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
    strictSpeedCap: config.strictSpeedCap ?? false,
    airControl: config.airControl,
    jumpStaminaCost: config.jumpStaminaCost,
    jumpCooldownS: config.jumpCooldownS,
    defensiveCircular: true,
    // Replays/configs from before item 11 keep the pre-rule behavior when these fields are absent.
    speedDamageGain: config.speedDamageGain ?? 0,
    dashCarriesSpeed: config.dashCarriesSpeed ?? false,
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
    strictSpeedCap: false,
    airControl: 1,
    jumpStaminaCost: 0,
    jumpCooldownS: 0,
    defensiveCircular: true,
    speedDamageGain: SPEED_DAMAGE_GAIN_DEFAULT,
    dashCarriesSpeed: true,
  };
}

/** Merges a pre-match override on top of defaults. Real-match defensive Circular cannot be disabled. */
export function resolveMatchConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return { ...createDefaultMatchConfig(), ...overrides, defensiveCircular: true };
}

export function arenaGeometryOf(config: MatchConfig): ArenaGeometry {
  return {
    wallHeightM: config.arenaWallHeightM,
    wallRestitution: config.arenaWallRestitution,
    floor: config.arenaFloor ?? 'flat',
    floorDepthM: config.arenaBowlDepthM ?? BOWL_DEPTH_M,
  };
}

/** Slider ranges for Pregame rules. PROVISIONAL except the acceleration reach required by the Master Design. */
export const ARENA_BOWL_DEPTH_RANGE = { min: 0, max: 5, step: 0.25 } as const;
export const ROUND_TIME_LIMIT_RANGE = { min: 0, max: 180, step: 15 } as const;
/** Master §12: the default ~11 m/s / 14 m/s² reaches ~3.1 s at ×0.25. */
export const ACCELERATION_SCALE_RANGE = { min: 0.25, max: 2, step: 0.05 } as const;
export const TOP_SPEED_SCALE_RANGE = { min: 0.5, max: 1.5, step: 0.05 } as const;
export const AIR_CONTROL_RANGE = { min: 0, max: 3, step: 0.1 } as const;
export const JUMP_STAMINA_COST_RANGE = { min: 0, max: 20, step: 1 } as const;
export const JUMP_COOLDOWN_RANGE = { min: 0, max: 3, step: 0.1 } as const;

export function arenaFloorOf(config: MatchConfig): ArenaFloor {
  return { id: config.arenaFloor ?? 'flat', depthM: config.arenaBowlDepthM ?? BOWL_DEPTH_M };
}

export function roundStateOptionsOf(config: MatchConfig): {
  ringOutDelayS: number;
  timeLimitS: number;
  winConditions: { ko: boolean; ringOut: boolean; spinOut: boolean };
} {
  return {
    ringOutDelayS: config.ringOutDelayS,
    timeLimitS: config.roundTimeLimitS ?? 0,
    winConditions: { ko: config.winByKo ?? true, ringOut: config.winByRingOut ?? true, spinOut: config.winBySpinOut ?? true },
  };
}
