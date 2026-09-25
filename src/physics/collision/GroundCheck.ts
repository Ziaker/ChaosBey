// ============================================================
// GROUND CHECK
// Shared "is this body currently resting on a surface" query, used by
// movement (to decide whether ground grip applies), drift (to know when a
// hop has landed) and the debug overlay (grounded/contact state). One
// raycast implementation avoids every consumer rolling its own contact
// detection (GDD section 1.4/159: no duplicated ad hoc physics queries).
// ============================================================

import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../world/PhysicsWorld';

// How far below the collider's bottom we still count as "touching" — must
// absorb ordinary floating point / one-tick settling jitter without
// mistaking a real small hop for still being grounded.
const GROUND_CHECK_TOLERANCE_M = 0.03;

export function isGrounded(
  physics: PhysicsWorld,
  body: RAPIER.RigidBody,
  colliderHalfHeightM: number,
  excludeCollider: RAPIER.Collider,
): boolean {
  const translation = body.translation();
  const ray = new RAPIER.Ray({ x: translation.x, y: translation.y, z: translation.z }, { x: 0, y: -1, z: 0 });
  const maxToi = colliderHalfHeightM + GROUND_CHECK_TOLERANCE_M;

  const hit = physics.rapierWorld.castRay(ray, maxToi, true, undefined, undefined, excludeCollider, undefined);
  return hit !== null;
}
