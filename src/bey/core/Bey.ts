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
import { DriftController } from '../../drift/DriftController';
import { MovementController } from '../movement/MovementController';
import { SpinController } from '../spin/SpinController';
import { StabilitySystem } from '../stability/StabilitySystem';
import { StaminaSystem } from '../stamina/StaminaSystem';
import { createBeyRigidBody } from './BeyRigidBody';

export interface Bey {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly movement: MovementController;
  readonly spin: SpinController;
  readonly drift: DriftController;
  readonly stamina: StaminaSystem;
  readonly stability: StabilitySystem;
  readonly attackEnergy: AttackEnergySystem;
  readonly attack: AttackController;
}

export function createBey(physics: PhysicsWorld, spawnPosition: { x: number; y: number; z: number }): Bey {
  const { body, collider } = createBeyRigidBody(physics, spawnPosition);
  return {
    body,
    collider,
    movement: new MovementController(),
    spin: new SpinController(),
    drift: new DriftController(),
    stamina: new StaminaSystem(),
    stability: new StabilitySystem(),
    attackEnergy: new AttackEnergySystem(),
    attack: new AttackController(),
  };
}
