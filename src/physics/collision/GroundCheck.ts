// ============================================================
// GROUND CHECK
// Shared "is this body currently resting on a surface" query, used by
// movement (to decide whether ground grip applies), drift (to know when a
// hop has landed) and the debug overlay (grounded/contact state). One
// implementation avoids every consumer rolling its own contact detection
// (GDD section 1.4/159: no duplicated ad hoc physics queries).
//
// Uses Rapier's real narrow-phase contact manifolds rather than a fixed-
// distance raycast: a raycast whose maxToi is derived from the collider's
// upright half-height is wrong the moment the Bey tilts — a tilted
// cylinder's lowest point can be much farther from its center than
// halfHeight, so a still-grounded Bey could get falsely reported as
// airborne right when tilt/impact response matters most (GDD section 17:
// translational and rotational state are related, not independent).
// Reading the actual contact normal is correct at any tilt angle, because
// the floor's own normal stays ~vertical regardless of how the Bey itself
// is oriented.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../world/PhysicsWorld';

// A contact within this distance (meters) of actually touching counts as
// grounded — Rapier reports "speculative" contacts slightly before real
// touching (for CCD purposes), which would otherwise be mistaken for
// ground contact a frame early.
const GROUND_CONTACT_DIST_THRESHOLD_M = 0.02;
// How vertical a contact normal must be to count as "floor-like" rather
// than "wall-like". 0.5 ≈ within 60° of straight up/down.
const GROUND_CONTACT_MIN_NORMAL_Y = 0.5;

export function isGrounded(physics: PhysicsWorld, beyCollider: RAPIER.Collider): boolean {
  let grounded = false;

  physics.rapierWorld.contactPairsWith(beyCollider, (otherCollider) => {
    if (grounded) return;

    physics.rapierWorld.contactPair(beyCollider, otherCollider, (manifold) => {
      if (grounded) return;

      const contactCount = manifold.numContacts();
      let isActuallyTouching = false;
      for (let i = 0; i < contactCount; i++) {
        if (manifold.contactDist(i) <= GROUND_CONTACT_DIST_THRESHOLD_M) {
          isActuallyTouching = true;
          break;
        }
      }
      if (!isActuallyTouching) return;

      // Direction (which collider is "1" vs "2") can be flipped internally
      // by Rapier; taking the absolute value sidesteps needing to know
      // which way this particular manifold points.
      if (Math.abs(manifold.normal().y) >= GROUND_CONTACT_MIN_NORMAL_Y) {
        grounded = true;
      }
    });
  });

  return grounded;
}
