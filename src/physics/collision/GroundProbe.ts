// ============================================================
// GROUND PROBE — CONTACT + SURFACE NORMAL (DEBUG READ)
// Same contact test as GroundCheck.isGrounded (identical thresholds), but
// also reports the surface normal and contact count for Debug Lab
// inspection and normal visualization (GDD sections 69/71). Gameplay keeps
// using isGrounded; this only reads the contact graph Rapier already built.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../world/PhysicsWorld';
import { GROUND_CONTACT_DIST_THRESHOLD_M, GROUND_CONTACT_MIN_NORMAL_Y } from './GroundCheck';

export interface GroundProbeResult {
  /** Same meaning as isGrounded(). */
  readonly grounded: boolean;
  /** Upward-oriented unit normal of the steepest-up touching contact, or null when not grounded. */
  readonly groundNormal: { x: number; y: number; z: number } | null;
  /** Touching contacts across every pair (ground, walls, the other Bey): one per touching pair. */
  readonly touchingContactCount: number;
  /** World-space solver contact points (at most MAX_REPORTED_POINTS), for debug drawing. */
  readonly contactPointsWorld: readonly { x: number; y: number; z: number }[];
}

const MAX_REPORTED_POINTS = 8;

export function probeGround(physics: PhysicsWorld, beyCollider: RAPIER.Collider): GroundProbeResult {
  let groundNormal: { x: number; y: number; z: number } | null = null;
  let touchingContactCount = 0;
  const contactPointsWorld: { x: number; y: number; z: number }[] = [];

  physics.rapierWorld.contactPairsWith(beyCollider, (otherCollider) => {
    // Solver contact points (debug drawing) from the stored manifold; the
    // touching test and normal computed fresh, as GroundCheck does (M11: a
    // resting rotation-locked Bey stops refreshing the manifold).
    physics.rapierWorld.contactPair(beyCollider, otherCollider, (manifold) => {
      for (let i = 0; i < manifold.numSolverContacts() && contactPointsWorld.length < MAX_REPORTED_POINTS; i++) {
        const point = manifold.solverContactPoint(i);
        if (point) contactPointsWorld.push({ x: point.x, y: point.y, z: point.z });
      }
    });
    const contact = beyCollider.contactCollider(otherCollider, GROUND_CONTACT_DIST_THRESHOLD_M);
    if (!contact || contact.distance > GROUND_CONTACT_DIST_THRESHOLD_M) return;
    touchingContactCount++;
    const n = contact.normal1;
    if (Math.abs(n.y) < GROUND_CONTACT_MIN_NORMAL_Y) return;
    const up = n.y < 0 ? { x: -n.x, y: -n.y, z: -n.z } : { x: n.x, y: n.y, z: n.z };
    if (!groundNormal || up.y > groundNormal.y) groundNormal = up;
  });

  return { grounded: groundNormal !== null, groundNormal, touchingContactCount, contactPointsWorld };
}
