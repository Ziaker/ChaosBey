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
import { BEY_BODY_COLLISION_GROUPS, BEY_BUMPER_COLLISION_GROUPS } from '../../physics/collision/CollisionGroups';
import { beyColliderRestitution, motionParams, type MotionParams } from '../motion/MotionPresets';
import { DEFAULT_PHYSICAL_PROFILE, type BeyPhysicalProfile } from '../archetype/BeyPhysicalProfile';

/** Half-height of the Bey-Bey bumper collider: Beys whose centres are more than twice this apart vertically pass over each other. */
export const BEY_BUMPER_HALF_HEIGHT_M = 0.6;

export interface BeyRigidBody {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
}

export function createBeyRigidBody(
  physics: PhysicsWorld,
  spawnPosition: { x: number; y: number; z: number },
  physical: BeyPhysicalProfile = DEFAULT_PHYSICAL_PROFILE,
  motion: MotionParams = motionParams(),
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
      .setCcdEnabled(true) // thin arena walls + a fast-moving Bey risk tunneling through in one fixed tick without continuous collision detection.
      // M11: the body never rotates. Tilt is the Motion Lab attitude
      // (SpinController); a tilting flat cylinder rolled on its rim like a
      // coin and was dragged around lying down (see SpinController's doc).
      .lockRotations()
      // A Bey is always in play: never let Rapier put it to sleep (a resting,
      // rotation-locked body did, and a sleeping body reports no floor
      // contact — it read as airborne and would not drive).
      .setCanSleep(false),
  );

  const collider = physics.rapierWorld.createCollider(
    RAPIER.ColliderDesc.cylinder(physical.colliderHalfHeightM, physical.colliderRadiusM)
      .setMass(physical.massKg)
      // Motion direction (M11): Bey-Bey, floor and wall bounce all come
      // from the direction — see beyColliderRestitution (MULTIPLY rule).
      .setRestitution(beyColliderRestitution(motion))
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setFriction(BEY_MATERIAL.friction)
      .setCollisionGroups(BEY_BODY_COLLISION_GROUPS),
    body,
  );
  // Bey-Bey contact goes through a tall, massless bumper (see
  // physics/collision/CollisionGroups.ts), same radius and materials.
  physics.rapierWorld.createCollider(
    RAPIER.ColliderDesc.cylinder(BEY_BUMPER_HALF_HEIGHT_M, physical.colliderRadiusM)
      .setDensity(0)
      .setRestitution(beyColliderRestitution(motion))
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setFriction(BEY_MATERIAL.friction)
      .setCollisionGroups(BEY_BUMPER_COLLISION_GROUPS),
    body,
  );

  return { body, collider };
}
