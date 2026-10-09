// ============================================================
// BEY REAL — FROM THE SLIDERS TO THE MATCH'S RULES
// The mode's sliders are in the lab's units (m/s, m/s², m). Most of what they change already has a rule in the match
// (MatchConfig): the stage's radius is the arena size scale, the jump's apex and the gravity are the jump height and the
// gravity scale… This turns one into the other, once, so a Bey Real match is an ordinary MatchConfig plus `real` — one path
// into the engine, one place the replay records.
// ============================================================

import { MATCH_BOWL_DEPTH_DEFAULT_M } from '../../arena/floor/ArenaFloorProfile';
import { ARENA_FLOOR_RADIUS } from '../../arena/colliders/ArenaTuning';
import { CIRCULAR_LAUNCH_HORIZONTAL_MPS } from '../../combat/attacks/AttackTuning';
import type { MatchConfig } from '../../config/match/MatchConfig';
import { DODGE_BURST_SPEED_MPS } from '../../dodge/DodgeTuning';
import { GRAVITY_MPS2 } from '../../physics/world/PhysicsWorld';
import { STAMINA_MAX } from '../stamina/StaminaTuning';
import { realModeConfigOf, type RealParams } from './RealTuning';

/** The lab drew the game's funnel (7 m deep over a 36 m floor) and played on a small stage: the slope the owner tuned against. */
const LAB_BOWL_DEPTH_M = MATCH_BOWL_DEPTH_DEFAULT_M;
/** The funnel profile is a power of the radius (h ∝ r^1.3): the exponent keeps the slope the same on a smaller stage. */
const FUNNEL_EXPONENT = 1.3;

/** The bowl depth that gives a stage of this radius the slope the lab's stage had at the same distance from the centre. */
export function labEquivalentBowlDepthM(stageRadiusM: number): number {
  const scale = stageRadiusM / ARENA_FLOOR_RADIUS;
  return LAB_BOWL_DEPTH_M * scale ** FUNNEL_EXPONENT;
}

/** The match rules a Bey Real setup sets (on top of the ordinary rules): everything the mode's sliders reach. */
export function realMatchOverrides(params: RealParams): Partial<MatchConfig> {
  const gravityScale = params.gravityMps2 / GRAVITY_MPS2;
  return {
    real: realModeConfigOf(params),
    // arena and rules
    arenaSizeScale: params.stageRadiusM / ARENA_FLOOR_RADIUS,
    arenaWallHeightM: params.wallHeightM,
    arenaWallRestitution: params.wallRestitution,
    arenaBowlDepthM: labEquivalentBowlDepthM(params.stageRadiusM) * params.bowlDepthScale,
    ringOutDelayS: params.ringOutDelayS,
    roundTimeLimitS: params.timeLimitS,
    // jump: the apex follows from the launch speed and the gravity
    gravityScale,
    jumpFullHeightM: (params.jumpSpeedMps * params.jumpSpeedMps) / (2 * params.gravityMps2),
    airControl: params.airControl,
    jumpCooldownS: params.jumpCooldownS,
    // actions
    dashCooldownS: params.dashCooldownS,
    dodgeCooldownS: params.dodgeCooldownS,
    dodgeDistanceScale: params.dodgeSpeedMps / DODGE_BURST_SPEED_MPS,
    dodgeStaminaCost: params.dodgeSpinCost * STAMINA_MAX,
    circularLaunchForce: params.circularLaunchMps / CIRCULAR_LAUNCH_HORIZONTAL_MPS,
    // The Dash is the lab's own (10 to 30 m/s): the classic top-speed scale (×2.8) must not multiply it.
    topSpeedScale: 1,
    // The lab ran in real time (×1); the classic game's 20% faster clock is its own owner decision. The mode has its own slider.
    gameSpeed: params.gameSpeed,
    // The mode has its own slope pull (bowlPull): the classic funnel slide must not add to it.
    funnelPull: 0,
  };
}

/** The rule keys a Bey Real match takes from the mode's sliders: the classic Advanced controls for these are locked while the mode is on. */
export const REAL_OWNED_RULE_KEYS = [
  'arenaSizeScale', 'arenaBowlDepthM', 'ringOutDelayS', 'roundTimeLimitS', 'gravityScale', 'jumpFullHeightM', 'airControl', 'jumpCooldownS',
  'dashCooldownS', 'dodgeCooldownS', 'dodgeDistanceScale', 'dodgeStaminaCost', 'circularLaunchForce', 'gameSpeed', 'funnelPull',
  // the classic handling model: the mode moves the Bey with its own forces
  'accelerationScale', 'topSpeedScale', 'turnRateScale', 'turnSpeedRetention', 'highSpeedControl', 'spinStaminaDrain', 'movementStaminaDrain',
  // a plain touch between two Beys is the real contact model's: the classic body-collision damage and momentum loss do not run
  'bodyCollisionDamage', 'momentumLossOnCollision',
] as const;
