// ============================================================
// LANDING BURST VFX
// A simple expanding, fading ring at a landing's touchdown point, sized by
// DriftController's landingIntensity (via ImpactMagnitude.landingMagnitude
// — Milestone 4). Procedural placeholder geometry, same precedent as
// Milestone 1's placeholder Bey mesh (GDD section 167).
//
// `tintHex` (Milestone 6) lets a caller color this ring with a specific
// Bey's own BeyParticleProfile.landingTintHex instead of the fixed
// default — see VfxManager, which is the real per-archetype-identity
// consumer.
// ============================================================

import * as THREE from 'three';
import type { WorldPositionM } from '../camera/ImpactEvents';
import { LANDING_RING_BASE_RADIUS_M, LANDING_RING_COLOR_HEX, LANDING_RING_LIFETIME_S, LANDING_RING_MAX_EXTRA_RADIUS_M } from './VfxTuning';

// A unit ring (outer radius 1) — updateLandingBurst scales it up to the
// actual current radius each frame instead of regenerating geometry.
const UNIT_RING_INNER_RADIUS = 0.82;
const UNIT_RING_OUTER_RADIUS = 1;
const UNIT_RING_SEGMENTS = 32;

export interface ActiveLandingBurst {
  mesh: THREE.Mesh;
  ageS: number;
  lifetimeS: number;
  maxRadiusM: number;
}

export function createLandingBurst(magnitude: number, positionM: WorldPositionM, tintHex: number = LANDING_RING_COLOR_HEX): ActiveLandingBurst {
  const maxRadiusM = LANDING_RING_BASE_RADIUS_M + magnitude * LANDING_RING_MAX_EXTRA_RADIUS_M;
  const geometry = new THREE.RingGeometry(UNIT_RING_INNER_RADIUS, UNIT_RING_OUTER_RADIUS, UNIT_RING_SEGMENTS);
  const material = new THREE.MeshBasicMaterial({ color: tintHex, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2; // flat on the ground.
  mesh.position.set(positionM.x, positionM.y + 0.02, positionM.z);
  mesh.scale.setScalar(0.05);
  mesh.frustumCulled = false;

  return { mesh, ageS: 0, lifetimeS: LANDING_RING_LIFETIME_S, maxRadiusM };
}

/** Advances the burst by `dtS`, returns false once its lifetime has elapsed (caller should then remove/dispose it). */
export function updateLandingBurst(burst: ActiveLandingBurst, dtS: number): boolean {
  burst.ageS += dtS;
  const t = Math.min(1, burst.ageS / burst.lifetimeS);
  const radiusM = 0.05 + t * burst.maxRadiusM;
  burst.mesh.scale.setScalar(radiusM);
  (burst.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
  return burst.ageS < burst.lifetimeS;
}

export function disposeLandingBurst(burst: ActiveLandingBurst): void {
  burst.mesh.geometry.dispose();
  (burst.mesh.material as THREE.Material).dispose();
}
