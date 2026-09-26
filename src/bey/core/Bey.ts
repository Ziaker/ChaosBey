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
import { AttackEnergySystem } from '../attack-energy/AttackEnergySystem';
import { DodgeController } from '../../dodge/DodgeController';
import { DriftController } from '../../drift/DriftController';
import { MovementController } from '../movement/MovementController';
import { SpinController } from '../spin/SpinController';
import { StabilitySystem } from '../stability/StabilitySystem';
import { StaminaSystem } from '../stamina/StaminaSystem';
import { createBeyRigidBody } from './BeyRigidBody';
import { DEFAULT_BEY_DEFINITION, type BeyDefinition } from '../archetype/BeyDefinition';
import { resolveBeyStats } from '../archetype/BeyStatsResolution';
import type { BeyStats } from '../archetype/BeyStats';

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
  readonly attackEnergy: AttackEnergySystem;
  readonly attack: AttackController;
}

export function createBey(
  physics: PhysicsWorld,
  spawnPosition: { x: number; y: number; z: number },
  definition: BeyDefinition = DEFAULT_BEY_DEFINITION,
): Bey {
  const { body, collider } = createBeyRigidBody(physics, spawnPosition, definition.physical);
  const stats = resolveBeyStats(definition.ratings);
  return {
    definition,
    stats,
    body,
    collider,
    movement: new MovementController(definition.handling),
    spin: new SpinController(),
    drift: new DriftController(),
    dodge: new DodgeController(),
    stamina: new StaminaSystem(stats.stamina),
    stability: new StabilitySystem(),
    attackEnergy: new AttackEnergySystem(),
    attack: new AttackController(),
  };
}
