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
import { BOWL_DEPTH_M, DEFAULT_ARENA_FLOOR, MATCH_BOWL_DEPTH_DEFAULT_M, type ArenaFloor, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
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
import { FUNNEL_PULL_DEFAULT } from '../../bey/movement/MovementTuning';
import { DODGE_COOLDOWN_S } from '../../dodge/DodgeTuning';
import { CIRCULAR_LAUNCH_FORCE_DEFAULT } from '../../combat/attacks/AttackTuning';
import { SPEED_DAMAGE_GAIN_DEFAULT } from '../../combat/attacks/SpeedDamage';
import { JUMP_HOLD_FOR_FULL_DEFAULT_S } from '../../drift/DriftTuning';

export interface MatchConfig {
  /** Multiplies the real knockback/Stability consequence a Clash resolution applies (both the FirstWins/SecondWins loser's knockback and a Tie's symmetric repulsion) — GDD section 152's "configurable impact multiplier". */
  clashImpactMultiplier: number;
  /**
   * Owner, 2026-10-04 ("a força do knockback aplicado ao inimigo ao ganhar um clash devia ser MUITO maior"): the Clash
   * loser is launched at least this fast (m/s, × knockbackScale) away from the winner, with ~45% of it upward. 0 = the
   * hit's own knockback only. Pregame slider.
   */
  clashLaunchMps: number;
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
  /** Owner, 2026-10-04 ("o dodge ainda reduz MUITA stamina … remover isso completamente"): Stamina a dodge costs. 0 by default. Pregame slider. */
  dodgeStaminaCost: number;
  /** Owner, 2026-10-04 ("cadê o slider de o quão longe ele vai?"): × the dodge's distance (its burst speed; same duration). Pregame slider. */
  dodgeDistanceScale: number;
  /** Owner, 2026-10-04 ("slider de força de impulsão vertical causada ao contato"): upward speed (m/s) a contact push adds. Pregame slider. */
  contactLiftMps: number;
  /** Owner, 2026-10-04 ("slider de força de knockback no geral"): × every knockback (hits, collisions, Circular launch, repel, recoil). Pregame slider. */
  knockbackScale: number;
  /** Owner, 2026-10-04: × the base spin Stamina drain (Stamina 0 = spin-out). Pregame slider. */
  spinStaminaDrain: number;
  /** Owner, 2026-10-04: seconds after taking damage during which the (defensive) Circular can't be started. Pregame slider. */
  circularLockAfterHitS: number;
  /**
   * Owner, 2026-10-04 ("reduza o timer de perda de controle no chão ao contato contra o bey inimigo sem atacar […]
   * adicione isso como slider, reduza em 20%"): × the control-loss window of a plain body contact (no attack). Pregame slider.
   */
  bodyContactControlLossScale: number;
  /** Owner, 2026-10-04: stage size, × the 36 m floor radius (1 = as designed). Pregame slider. */
  arenaSizeScale: number;
  /**
   * Owner, 2026-10-04 ("o feeling de velocidade do jogo ainda está MUITO baixo, deixe tudo no mínimo 20% mais rápido e
   * faça isso ser um slider"): the whole match runs this much faster than real time — movement, attacks, gravity,
   * effects, timers. Same ticks (replays and determinism unchanged), just more of them per real second. Pregame slider.
   */
  gameSpeed: number;
  /** Owner, 2026-10-04 ("qualquer toque devia jogar os beys longe um do outro"): every contact pushes both Beys apart at least this fast (m/s). Pregame slider. */
  contactRepelMps: number;
  /** Owner, 2026-10-04 ("o recoil deve ser alto também, que nem na vida real"): an attack that lands throws its attacker back this fast (m/s); the defender at least 1.5× the contact repel. Pregame slider. */
  attackRecoilMps: number;
  /** Owner, 2026-10-04: gravity multiplier (×1 = 10.5 m/s²). Jump heights stay the same, they just take less time. Pregame slider. */
  gravityScale: number;
  /** Owner, 2026-10-04: multiplier on every Bey's turn rate (×1.45 default). Pregame slider. */
  turnRateScale: number;
  /** Owner, 2026-10-04: 0..1 — 1 = steering control does not fall as the Bey gets faster (0 = the old slip at speed). Pregame slider. */
  highSpeedControl: number;
  /** Owner, 2026-10-04: 0..1 share of the speed a turn would lose that is kept (0 = the old turns). Pregame slider. */
  turnSpeedRetention: number;
  topSpeedScale: number;
  airControl: number;
  /** Stamina a hop/jump costs (0 = free); a Bey without that much can't jump. */
  jumpStaminaCost: number;
  /** Seconds after a hop/jump begins before the next can (0 = none). */
  jumpCooldownS: number;
  /** Owner, 2026-10-04: X released before this (s) = short hop, still held = full jump. Nothing else picks the height. Pregame slider. */
  jumpHoldForFullS: number;
  /**
   * Owner, 2026-10-02 (item 13): the Circular is defensive (its user takes nothing; whoever touches it is launched).
   * Always on in a match; false only for bare constructions (createBey without match rules: the Camera Lab), which
   * keep the pre-2026-10-02 Circular like their jump and ring-out. Not a Pregame option.
   */
  defensiveCircular: boolean;
  /**
   * Owner, 2026-10-04 (item 11): "quanto mais rápido, mais dano". How much an attack hit's damage follows the
   * attacker's speed (see combat/attacks/SpeedDamage.ts); 0 = off. PROVISIONAL 0.5. Pregame slider.
   */
  speedDamageGain: number;
  /** Item 11: a Dash keeps the speed built up before it (momentum) instead of resetting to its own speed. PROVISIONAL on. Pregame toggle. */
  dashCarriesSpeed: boolean;
  /**
   * Owner, 2026-10-05 ("Ataque giratório - ligado (base) e desligado"): false = no Circular at all — a tap does nothing
   * (Attack held = Dash as always), the AI never uses it (no counter either). Clash unchanged. Pregame toggle, on.
   */
  circularAttack: boolean;
  /**
   * Owner, 2026-10-05 ("Tamanho do bey in-game"): × both Beys' size — body, model, attack reach, vortex and the AI's
   * ranges; same mass. Pregame slider, ×1.
   */
  beySizeScale: number;
  /**
   * Owner, 2026-10-05 ("recovery time … o slider trata apenas o mínimo … a força do ataque aumente esse tempo"): seconds
   * a launched Bey must fly before the Air Recovery can be pressed — this minimum plus AIR_RECOVERY_DELAY_PER_FORCE_S
   * per unit of the launching force (capped). Pregame slider, 0.2 s.
   */
  airRecoveryMinDelayS: number;
  /**
   * Owner, 2026-10-08 ("a física não tá sendo aplicada ... o bey só deveria ficar completamente parado na parte plana do
   * funil"): × the pull of the floor's slope on every Bey (gravity's component along the floor, accumulated as a slide
   * velocity the handling model does not damp). 0 = none (the pre-0.48 behaviour); 1 = gravity as it is. Pregame slider.
   */
  funnelPull: number;
  /**
   * Owner, 2026-10-08 ("quando for implementar os Rails, eles devem ser opção no pré jogo"): the stages' rails are on / off
   * (docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md). Off = the match is played as if the stages had none. No stage has a rail
   * yet (the layouts are an owner decision), so today this changes nothing. Pregame switch (Advanced › Arena). PROVISIONAL: on.
   */
  railsEnabled: boolean;
}

/** The per-Bey gameplay rules of a match: what createBey() needs from MatchConfig. */
export type BeyMatchRules = Pick<MatchConfig, 'dashCooldownS' | 'momentumGain' | 'momentumFillS' | 'momentumDecayS' | 'bodyCollisionDamage' | 'momentumLossOnCollision' | 'jumpFullHeightM' | 'jumpShortHopHeightM' | 'movementStaminaDrain' | 'dodgeCooldownS' | 'circularLaunchForce' | 'accelerationScale' | 'gravityScale' | 'contactRepelMps' | 'attackRecoilMps' | 'dodgeStaminaCost' | 'dodgeDistanceScale' | 'contactLiftMps' | 'knockbackScale' | 'spinStaminaDrain' | 'circularLockAfterHitS' | 'bodyContactControlLossScale' | 'turnRateScale' | 'turnSpeedRetention' | 'highSpeedControl' | 'topSpeedScale' | 'airControl' | 'jumpStaminaCost' | 'jumpCooldownS' | 'jumpHoldForFullS' | 'defensiveCircular' | 'speedDamageGain' | 'dashCarriesSpeed' | 'circularAttack' | 'beySizeScale' | 'airRecoveryMinDelayS' | 'funnelPull'>;

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
    turnRateScale: config.turnRateScale,
    gravityScale: config.gravityScale,
    contactRepelMps: config.contactRepelMps,
    attackRecoilMps: config.attackRecoilMps,
    dodgeStaminaCost: config.dodgeStaminaCost,
    dodgeDistanceScale: config.dodgeDistanceScale,
    contactLiftMps: config.contactLiftMps,
    knockbackScale: config.knockbackScale,
    spinStaminaDrain: config.spinStaminaDrain,
    circularLockAfterHitS: config.circularLockAfterHitS,
    bodyContactControlLossScale: config.bodyContactControlLossScale,
    turnSpeedRetention: config.turnSpeedRetention,
    highSpeedControl: config.highSpeedControl,
    topSpeedScale: config.topSpeedScale,
    airControl: config.airControl,
    jumpStaminaCost: config.jumpStaminaCost,
    jumpCooldownS: config.jumpCooldownS,
    jumpHoldForFullS: config.jumpHoldForFullS,
    defensiveCircular: config.defensiveCircular ?? true,
    speedDamageGain: config.speedDamageGain,
    dashCarriesSpeed: config.dashCarriesSpeed,
    circularAttack: config.circularAttack ?? true,
    beySizeScale: config.beySizeScale ?? 1,
    airRecoveryMinDelayS: config.airRecoveryMinDelayS ?? 0,
    funnelPull: config.funnelPull ?? 0,
  };
}

export function createDefaultMatchConfig(): MatchConfig {
  return withOwnerBaseRules({
    clashImpactMultiplier: CLASH_IMPACT_MULTIPLIER_DEFAULT,
    clashLaunchMps: 28,
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
    arenaBowlDepthM: MATCH_BOWL_DEPTH_DEFAULT_M,
    roundTimeLimitS: 0,
    winByKo: true,
    winByRingOut: true,
    winBySpinOut: true,
    accelerationScale: SPEED_FEEL_SCALE_DEFAULT,
    topSpeedScale: SPEED_FEEL_SCALE_DEFAULT,
    turnRateScale: SPEED_FEEL_SCALE_DEFAULT,
    gravityScale: GRAVITY_SCALE_DEFAULT,
    contactRepelMps: CONTACT_REPEL_DEFAULT_MPS,
    arenaSizeScale: 1,
    gameSpeed: 1.2,
    circularLockAfterHitS: 0.6,
    bodyContactControlLossScale: 0.8,
    contactLiftMps: 4,
    knockbackScale: 1,
    spinStaminaDrain: 1,
    dodgeStaminaCost: 0,
    dodgeDistanceScale: 1,
    attackRecoilMps: ATTACK_RECOIL_DEFAULT_MPS,
    turnSpeedRetention: TURN_SPEED_RETENTION_DEFAULT,
    highSpeedControl: 1,
    airControl: 1,
    jumpStaminaCost: 0,
    jumpCooldownS: 0,
    jumpHoldForFullS: JUMP_HOLD_FOR_FULL_DEFAULT_S,
    defensiveCircular: true,
    speedDamageGain: SPEED_DAMAGE_GAIN_DEFAULT,
    dashCarriesSpeed: true,
    circularAttack: true,
    beySizeScale: 1,
    airRecoveryMinDelayS: AIR_RECOVERY_MIN_DELAY_DEFAULT_S,
    funnelPull: FUNNEL_PULL_DEFAULT,
    railsEnabled: true,
  });
}

/**
 * Owner, 2026-10-04: "a partir de agora use estas regras como base do jogo" — the rules the owner playtested and
 * approved (the Pregame's "Changed from the defaults" list) are now the defaults. Every one stays a Pregame slider.
 */
export const OWNER_BASE_RULES_2026_10_04 = {
  arenaWallHeightM: 2,
  arenaWallRestitution: 0.8,
  arenaFloor: 'bowl-b',
  arenaBowlDepthM: 8.5,
  momentumGain: 1.7,
  momentumDecayS: 2.5,
  momentumLossOnCollision: 0.1,
  jumpFullHeightM: 3.25,
  jumpShortHopHeightM: 0.5,
  movementStaminaDrain: 0.2,
  dodgeCooldownS: 1.25, // owner, 2026-10-05: "reduza o cooldown base pela metade" (was 2.5)
  accelerationScale: 1.9,
  topSpeedScale: 2.8,
  airControl: 1.5,
  turnRateScale: 1.75,
  turnSpeedRetention: 0.9,
  jumpHoldForFullS: 0.15,
  gravityScale: 3.6,
  contactRepelMps: 16.5,
  attackRecoilMps: 15.5,
} as const satisfies Partial<MatchConfig>;

function withOwnerBaseRules(config: MatchConfig): MatchConfig {
  return { ...config, ...OWNER_BASE_RULES_2026_10_04 };
}

/** Merges a pre-match override on top of the defaults, producing the single resolved MatchConfig the rest of the app consumes. */
export function resolveMatchConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return { ...createDefaultMatchConfig(), ...overrides };
}

/** The arena values of a resolved config, in the shape the arena builder takes. */
export function arenaGeometryOf(config: MatchConfig): ArenaGeometry {
  // A config without a floor predates floors: flat (as MatchSession and replay playback read it too).
  return { wallHeightM: config.arenaWallHeightM, wallRestitution: config.arenaWallRestitution, floor: config.arenaFloor ?? 'flat', floorDepthM: config.arenaBowlDepthM ?? BOWL_DEPTH_M, sizeScale: config.arenaSizeScale ?? 1 };
}

/** Slider ranges for the Lote 9 rules (owner, 2026-10-02). PROVISIONAL. */
// Owner, 2026-10-05: "aumente o limite do slider do funilamento dos stages em 50%" — max 12 -> 18 m (default unchanged).
export const ARENA_BOWL_DEPTH_RANGE = { min: 0, max: 18, step: 0.25 } as const;
/** Owner, 2026-10-05: Bey size slider. PROVISIONAL range. */
export const BEY_SIZE_SCALE_RANGE = { min: 0.5, max: 2, step: 0.05 } as const;
/** Owner, 2026-10-05: the recovery time slider (the minimum; the launching force adds to it). PROVISIONAL. */
export const AIR_RECOVERY_MIN_DELAY_DEFAULT_S = 0.2;
export { FUNNEL_PULL_RANGE } from '../../bey/movement/MovementTuning';
export const AIR_RECOVERY_MIN_DELAY_RANGE = { min: 0, max: 1.5, step: 0.05 } as const;
export const ROUND_TIME_LIMIT_RANGE = { min: 0, max: 180, step: 15 } as const;
export const ACCELERATION_SCALE_RANGE = { min: 0.25, max: 3, step: 0.05 } as const;
export const TOP_SPEED_SCALE_RANGE = { min: 0.5, max: 3, step: 0.05 } as const;
/** Owner, 2026-10-04: "no mínimo 45% mais rápidos … isso inclui controle de movimento". Default for top speed, acceleration and turn rate. PROVISIONAL. */
export const SPEED_FEEL_SCALE_DEFAULT = 1.45;
export const TURN_RATE_SCALE_RANGE = { min: 0.5, max: 3, step: 0.05 } as const;
/** Owner, 2026-10-04: "por que a gravidade não é realista?" — ×2.5 (26 m/s²): the full jump's 1.4 s in the air → 0.9 s. PROVISIONAL. */
export const GRAVITY_SCALE_DEFAULT = 2.5;
export const GRAVITY_SCALE_RANGE = { min: 1, max: 5, step: 0.1 } as const;
/** Owner, 2026-10-04: contact repel and attack recoil (m/s). PROVISIONAL. */
export const CONTACT_REPEL_DEFAULT_MPS = 9;
export const ATTACK_RECOIL_DEFAULT_MPS = 10;
export const IMPACT_PUSH_RANGE = { min: 0, max: 25, step: 0.5 } as const;
export const DODGE_STAMINA_COST_RANGE = { min: 0, max: 40, step: 1 } as const;
export const DODGE_DISTANCE_SCALE_RANGE = { min: 0.5, max: 3, step: 0.05 } as const;
export const CONTACT_LIFT_RANGE = { min: 0, max: 20, step: 0.5 } as const;
export const KNOCKBACK_SCALE_RANGE = { min: 0, max: 4, step: 0.05 } as const;
export const SPIN_STAMINA_DRAIN_RANGE = { min: 0, max: 20, step: 0.5 } as const;
export const CIRCULAR_LOCK_RANGE = { min: 0, max: 2, step: 0.05 } as const;
export const BODY_CONTACT_CONTROL_LOSS_RANGE = { min: 0, max: 2, step: 0.05 } as const;
export const ARENA_SIZE_SCALE_RANGE = { min: 0.5, max: 2.5, step: 0.05 } as const;
export const GAME_SPEED_RANGE = { min: 0.5, max: 2, step: 0.05 } as const;
export const CLASH_LAUNCH_RANGE = { min: 0, max: 60, step: 1 } as const;
/** Owner, 2026-10-04: "curvas não deviam reduzir tanto a velocidade" — share of the speed a turn would scrub off that is kept. PROVISIONAL 0.85. */
export const TURN_SPEED_RETENTION_DEFAULT = 0.85;
export const TURN_SPEED_RETENTION_RANGE = { min: 0, max: 1, step: 0.05 } as const;
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
