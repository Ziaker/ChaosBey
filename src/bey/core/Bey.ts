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
import { MatchMovementController } from '../movement/MatchMovementController';
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
  readonly momentum: MomentumSystem;
  readonly rules: BeyMatchRules;
  readonly arenaFloor: ArenaFloor;
  readonly motion: MotionParams;
}

export function createBey(
  physics: PhysicsWorld,
  spawnPosition: { x: number; y: number; z: number },
  definition: BeyDefinition = DEFAULT_BEY_DEFINITION,
  arenaFloor: ArenaFloor = 'flat',
  motion: MotionParams = motionParams(),
  matchRules?: BeyMatchRules,
): Bey {
  // Bare constructions keep legacy/prototype behavior: old jump, non-defensive Circular, no speed-to-damage or Dash carry.
  const rules: BeyMatchRules = matchRules ?? {
    ...beyMatchRulesOf(createDefaultMatchConfig()),
    jumpFullHeightM: LEGACY_JUMP_FULL_HEIGHT_M,
    defensiveCircular: false,
    speedDamageGain: 0,
    dashCarriesSpeed: false,
  };
  const { body, collider } = createBeyRigidBody(physics, spawnPosition, definition.physical, motion);
  const stats = resolveBeyStats(definition.ratings);
  const movement = new MatchMovementController(
    definition.handling,
    motion,
    { acceleration: rules.accelerationScale ?? 1, topSpeed: rules.topSpeedScale ?? 1, airControl: rules.airControl ?? 1 },
    rules.strictSpeedCap ?? false,
  );
  return {
    definition,
    stats,
    body,
    collider,
    movement,
    spin: new SpinController(motion),
    drift: new DriftController(movement.getLateralGripPerS(), matchRules),
    dodge: new DodgeController(rules.dodgeCooldownS),
    stamina: new StaminaSystem(stats.stamina, rules.movementStaminaDrain),
    stability: new StabilitySystem(),
    attack: new AttackController(definition.attack, rules.dashCooldownS, rules.dashCarriesSpeed ?? false),
    momentum: new MomentumSystem(rules),
    rules,
    arenaFloor,
    motion,
  };
}
