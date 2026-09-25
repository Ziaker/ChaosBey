// ============================================================
// BEY RIGID BODY
// Owns creation of the Bey's physics body/collider only. Movement, spin,
// and drift are separate components that read/write this body through its
// public RAPIER handles — this module does not decide how the Bey moves
// (GDD section 1.4: strict component separation).
// ============================================================

import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { BEY_MATERIAL } from '../../physics/materials/PhysicsMaterials';
import { BEY_COLLIDER_HALF_HEIGHT_M, BEY_COLLIDER_RADIUS_M, BEY_MASS_KG } from './BeyTuning';

export interface BeyRigidBody {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
}

export function createBeyRigidBody(
  physics: PhysicsWorld,
  spawnPosition: { x: number; y: number; z: number },
): BeyRigidBody {
  const body = physics.rapierWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
      // Linear/angular damping are handled explicitly by MovementController's
      // grip/drag model and SpinController's angular damping tuning — using
      // Rapier's generic damping too would be a second, competing source of
      // truth for the same behavior (GDD section 101).
      .setLinearDamping(0)
      .setAngularDamping(0)
      .setCcdEnabled(true), // thin arena walls + a fast-moving Bey risk tunneling through in one fixed tick without continuous collision detection.
  );

  const collider = physics.rapierWorld.createCollider(
    RAPIER.ColliderDesc.cylinder(BEY_COLLIDER_HALF_HEIGHT_M, BEY_COLLIDER_RADIUS_M)
      .setMass(BEY_MASS_KG)
      .setRestitution(BEY_MATERIAL.restitution)
      .setFriction(BEY_MATERIAL.friction),
    body,
  );

  return { body, collider };
}
