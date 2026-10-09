// ============================================================
// BEY — PER-COMBATANT COMPONENT BUNDLE
// Groups one Bey's physics handle and every system that owns per-Bey
// state. Bundling is just composition/wiring — each system inside still
// owns its own logic (GDD section 1.4); this is not a god object, nothing
// reaches into another system's internals through it.
// ============================================================

import { BEY_MATERIAL, FLOOR_MATERIAL } from '../../physics/materials/PhysicsMaterials';
import { GRAVITY_Y } from '../../physics/world/PhysicsWorld';
import type { ThrustCalibration } from '../movement/MovementController';
import { JUMP_SHORT_HOP_TARGET_APEX_M } from '../../drift/DriftTuning';
import { DODGE_STAMINA_COST } from '../../dodge/DodgeTuning';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { AttackController } from '../../combat/attacks/AttackController';
import { DodgeController } from '../../dodge/DodgeController';
import { DriftController } from '../../drift/DriftController';
import { MovementController } from '../movement/MovementController';
import { SpinController } from '../spin/SpinController';
import { StabilitySystem, stabilityScalesOf } from '../stability/StabilitySystem';
import { StaminaSystem } from '../stamina/StaminaSystem';
import { MomentumSystem } from '../momentum/MomentumSystem';
import { RailController } from '../../arena/rails/RailController';
import { RAIL_SPEED_DEFAULT, RAIL_TUNING, scaleRailTuning } from '../../arena/rails/RailTraversal';
import type { RailDefinition } from '../../arena/rails/RailBlueprint';
import { LEGACY_JUMP_FULL_HEIGHT_M } from '../../drift/DriftTuning';
import { createBeyRigidBody } from './BeyRigidBody';
import type { ArenaFloor } from '../../arena/floor/ArenaFloorProfile';
import { DEFAULT_BEY_DEFINITION, scaledBeyDefinition, type BeyDefinition } from '../archetype/BeyDefinition';
import { resolveBeyStats } from '../archetype/BeyStatsResolution';
import type { BeyStats } from '../archetype/BeyStats';
import { motionParams, type MotionParams } from '../motion/MotionPresets';
import { attackProfileOf, attackTuningOf, dodgeTuningOf, realSpinDrainOf, stabilityRecoveryOf } from '../real/realTunings';
import { beyMatchRulesOf, createDefaultMatchConfig, type BeyMatchRules } from '../../config/match/MatchConfig';

export interface Bey {
  readonly definition: BeyDefinition;
  /**
   * Resolved once at creation from definition.ratings (see
   * BeyStatsResolution.ts) — the only Attack/Defense/Stamina numbers any
   * physics/combat system may read. Never read definition.ratings
   * directly from outside this file; that 1-10 scale is player-facing
   * only (GDD section 6/31).
   */
  readonly stats: BeyStats;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly movement: MovementController;
  readonly spin: SpinController;
  readonly drift: DriftController;
  readonly dodge: DodgeController;
  readonly stamina: StaminaSystem;
  readonly stability: StabilitySystem;
  readonly attack: AttackController;
  /** Owner, 2026-10-02 (Lote 3): speed build-up (see bey/momentum/). */
  readonly momentum: MomentumSystem;
  /** Rail Grinding (0.52.0): this Bey's traversal of the stage's rails (none when the stage has none or the Pregame option is off). */
  readonly rail: RailController;
  /** The match's per-Bey rules (MatchConfig): build-time config, in the replay config snapshot. */
  readonly rules: BeyMatchRules;
  /** M11: the floor profile of the arena this Bey plays on (placement helpers put it on the floor). Not simulation state. */
  readonly arenaFloor: ArenaFloor;
  /** M11: the motion direction's parameters (Motion Lab A/B/C, from MatchConfig.motion) — gameplay, shared by every system that reads it. */
  readonly motion: MotionParams;
}

export function createBey(
  physics: PhysicsWorld,
  spawnPosition: { x: number; y: number; z: number },
  baseDefinition: BeyDefinition = DEFAULT_BEY_DEFINITION,
  arenaFloor: ArenaFloor = 'flat',
  motion: MotionParams = motionParams(),
  /** The match's per-Bey rules (MatchConfig); omitted = the defaults, with the pre-2026-10-02 jump (see LEGACY_JUMP_FULL_HEIGHT_M). */
  matchRules?: BeyMatchRules,
  /** The rails of the stage (already resolved onto its floor); none = no rail grinding. */
  rails: readonly RailDefinition[] = [],
  /** Bey Real: the way this Bey's spin turns (+1 first, -1 second): the way its path curves and the way it orbits. */
  realSpinDir: 1 | -1 = 1,
): Bey {
  const rules: BeyMatchRules = matchRules ?? { ...beyMatchRulesOf(createDefaultMatchConfig()), jumpFullHeightM: LEGACY_JUMP_FULL_HEIGHT_M, defensiveCircular: false, speedDamageGain: 0, dashCarriesSpeed: false,
    // Owner, 2026-10-04 speed pass: match-only. Bare constructions (the Camera Lab: camera frozen) keep the old handling.
    accelerationScale: 1, topSpeedScale: 1, turnRateScale: 1, turnSpeedRetention: 0, highSpeedControl: 0, funnelPull: 0, momentumGain: 1, gravityScale: 1, contactRepelMps: 0, attackRecoilMps: 0,
    momentumDecayS: 2, momentumLossOnCollision: 0.5, jumpShortHopHeightM: JUMP_SHORT_HOP_TARGET_APEX_M, movementStaminaDrain: 1, dodgeCooldownS: 3, airControl: 1, dodgeStaminaCost: DODGE_STAMINA_COST, dodgeDistanceScale: 1, contactLiftMps: 0, knockbackScale: 1, spinStaminaDrain: 1, circularLockAfterHitS: 0, bodyContactControlLossScale: 1 };
  // Owner, 2026-10-05 (MatchConfig.beySizeScale): the Bey at the match's size — body and attack reach, same mass.
  const definition = matchRules !== undefined ? scaledBeyDefinition(baseDefinition, rules.beySizeScale ?? 1) : baseDefinition;
  // A bigger body spawns as much higher, so it never starts inside the floor.
  const grownM = Math.max(0, definition.physical.colliderHalfHeightM - baseDefinition.physical.colliderHalfHeightM);
  const { body, collider } = createBeyRigidBody(physics, { ...spawnPosition, y: spawnPosition.y + grownM }, definition.physical, motion);
  const stats = resolveBeyStats(definition.ratings);
  const movement = new MovementController(definition.handling, motion, { acceleration: rules.accelerationScale ?? 1, topSpeed: rules.topSpeedScale ?? 1, airControl: rules.airControl ?? 1, turnRate: rules.turnRateScale ?? 1, turnSpeedRetention: rules.turnSpeedRetention ?? 0, highSpeedControl: rules.highSpeedControl ?? 0, thrustCalibration: thrustCalibrationFor(matchRules), funnelPull: rules.funnelPull ?? 0, gravityScale: rules.gravityScale ?? 1, real: rules.real ?? undefined, realSpinDir });
  return {
    definition,
    stats,
    body,
    collider,
    movement,
    spin: new SpinController(motion),
    // Bare constructions (no match rules: the Camera Lab, physics-only tests) keep the old immediate full-jump launch.
    drift: new DriftController(movement.getLateralGripPerS(), matchRules),
    dodge: new DodgeController(rules.dodgeCooldownS, rules.dodgeStaminaCost ?? DODGE_STAMINA_COST, rules.dodgeDistanceScale ?? 1, matchRules !== undefined, matchRules !== undefined ? (rules.airRecoveryMinDelayS ?? 0) : null, rules.real ? dodgeTuningOf(rules.real) : undefined),
    stamina: new StaminaSystem(stats.stamina, rules.movementStaminaDrain, rules.spinStaminaDrain ?? 1, rules.real ? realSpinDrainOf(rules.real) : null),
    stability: new StabilitySystem(rules.real ? stabilityRecoveryOf(rules.real) : undefined, stabilityScalesOf(rules)),
    attack: new AttackController(rules.real ? attackProfileOf(definition.attack, rules.real) : definition.attack, rules.dashCooldownS, rules.dashCarriesSpeed ?? false, rules.topSpeedScale ?? 1, rules.circularAttack ?? true, rules.real ? attackTuningOf(rules.real) : undefined),
    momentum: new MomentumSystem(rules),
    // A short hop's launch speed, from the Bey's own jump rules: what a Jump press gives when it leaves a rail.
    rail: new RailController(matchRules !== undefined && (rules.railsEnabled ?? false) ? rails : [], { tuning: scaleRailTuning(RAIL_TUNING, rules.railSpeed ?? RAIL_SPEED_DEFAULT), jumpExitLiftMps: Math.sqrt(2 * Math.abs(GRAVITY_Y) * (rules.gravityScale ?? 1) * (rules.jumpShortHopHeightM ?? JUMP_SHORT_HOP_TARGET_APEX_M)) }),
    rules,
    arenaFloor,
    motion,
  };
}

/** Owner, 2026-10-04: the floor friction's share of a match Bey's thrust (see ThrustCalibration). +20% net. */
const THRUST_NET_BOOST = 1.2;

function thrustCalibrationFor(matchRules: BeyMatchRules | undefined): ThrustCalibration | undefined {
  const gravityScale = matchRules?.gravityScale ?? 1;
  if (!(gravityScale > 1)) return undefined;
  // Rapier averages the two coefficients (Bey, floor); friction deceleration = μ × g.
  const brakeAtX1 = ((BEY_MATERIAL.friction + FLOOR_MATERIAL.friction) / 2) * Math.abs(GRAVITY_Y);
  return { oldBrakeMps2: brakeAtX1 * gravityScale, newBrakeMps2: brakeAtX1, netBoost: THRUST_NET_BOOST };
}
