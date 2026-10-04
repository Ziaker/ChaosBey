// ============================================================
// BEY — PER-COMBATANT COMPONENT BUNDLE
// Groups one Bey's physics handle and every system that owns per-Bey
// state. Bundling is just composition/wiring — each system inside still
// owns its own logic (GDD section 1.4); this is not a god object, nothing
// reaches into another system's internals through it.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { AttackController } from '../../combat/attacks/AttackController';
import { DodgeController } from '../../dodge/DodgeController';
import { DriftController } from '../../drift/DriftController';
import { MovementController } from '../movement/MovementController';
import { SpinController } from '../spin/SpinController';
import { StabilitySystem } from '../stability/StabilitySystem';
import { StaminaSystem } from '../stamina/StaminaSystem';
import { MomentumSystem } from '../momentum/MomentumSystem';
import { LEGACY_JUMP_FULL_HEIGHT_M } from '../../drift/DriftTuning';
import { createBeyRigidBody } from './BeyRigidBody';
import type { ArenaFloor } from '../../arena/floor/ArenaFloorProfile';
import { DEFAULT_BEY_DEFINITION, type BeyDefinition } from '../archetype/BeyDefinition';
import { resolveBeyStats } from '../archetype/BeyStatsResolution';
import type { BeyStats } from '../archetype/BeyStats';
import { motionParams, type MotionParams } from '../motion/MotionPresets';
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
  definition: BeyDefinition = DEFAULT_BEY_DEFINITION,
  arenaFloor: ArenaFloor = 'flat',
  motion: MotionParams = motionParams(),
  /** The match's per-Bey rules (MatchConfig); omitted = the defaults, with the pre-2026-10-02 jump (see LEGACY_JUMP_FULL_HEIGHT_M). */
  matchRules?: BeyMatchRules,
): Bey {
  const rules: BeyMatchRules = matchRules ?? { ...beyMatchRulesOf(createDefaultMatchConfig()), jumpFullHeightM: LEGACY_JUMP_FULL_HEIGHT_M, defensiveCircular: false, speedDamageGain: 0, dashCarriesSpeed: false,
    // Owner, 2026-10-04 speed pass: match-only. Bare constructions (the Camera Lab: camera frozen) keep the old handling.
    accelerationScale: 1, topSpeedScale: 1, turnRateScale: 1, turnSpeedRetention: 0, highSpeedControl: 0, momentumGain: 1, gravityScale: 1, contactRepelMps: 0, attackRecoilMps: 0 };
  const { body, collider } = createBeyRigidBody(physics, spawnPosition, definition.physical, motion);
  const stats = resolveBeyStats(definition.ratings);
  const movement = new MovementController(definition.handling, motion, { acceleration: rules.accelerationScale ?? 1, topSpeed: rules.topSpeedScale ?? 1, airControl: rules.airControl ?? 1, turnRate: rules.turnRateScale ?? 1, turnSpeedRetention: rules.turnSpeedRetention ?? 0, highSpeedControl: rules.highSpeedControl ?? 0 });
  return {
    definition,
    stats,
    body,
    collider,
    movement,
    spin: new SpinController(motion),
    // Bare constructions (no match rules: the Camera Lab, physics-only tests) keep the old immediate full-jump launch.
    drift: new DriftController(movement.getLateralGripPerS(), matchRules),
    dodge: new DodgeController(rules.dodgeCooldownS),
    stamina: new StaminaSystem(stats.stamina, rules.movementStaminaDrain),
    stability: new StabilitySystem(),
    attack: new AttackController(definition.attack, rules.dashCooldownS, rules.dashCarriesSpeed ?? false, rules.topSpeedScale ?? 1),
    momentum: new MomentumSystem(rules),
    rules,
    arenaFloor,
    motion,
  };
}
