// ============================================================
// SPARK BURST VFX
// A small radial burst of particles at an impact point, scaled by
// ImpactEvent.magnitude (Milestone 4). Simple procedural THREE.Points —
// same "engineering placeholder visual" precedent as Milestone 1's
// procedural Bey mesh (GDD section 167); the trigger/scaling logic is the
// approved part, not this exact look.
// ============================================================

import * as THREE from 'three';
import type { WorldPositionM } from '../camera/ImpactEvents';
import {
  SPARK_BASE_LIFETIME_S,
  SPARK_BASE_PARTICLE_COUNT,
  SPARK_BASE_SPEED_MPS,
  SPARK_COLOR_HEX,
  SPARK_GRAVITY_MPS2,
  SPARK_MAX_EXTRA_LIFETIME_S,
  SPARK_MAX_EXTRA_PARTICLE_COUNT,
  SPARK_MAX_EXTRA_SPEED_MPS,
  SPARK_SIZE_M,
} from './VfxTuning';

// Fibonacci/golden-angle sphere distribution — deterministic (not
// Math.random) so a burst is reproducible given the same magnitude.
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));

export interface ActiveSparkBurst {
  points: THREE.Points;
  velocitiesMps: Float32Array;
  ageS: number;
  lifetimeS: number;
}

export function createSparkBurst(magnitude: number, positionM: WorldPositionM): ActiveSparkBurst {
  const particleCount = Math.max(1, Math.round(SPARK_BASE_PARTICLE_COUNT + magnitude * SPARK_MAX_EXTRA_PARTICLE_COUNT));
  const speedMps = SPARK_BASE_SPEED_MPS + magnitude * SPARK_MAX_EXTRA_SPEED_MPS;
  const positions = new Float32Array(particleCount * 3);
  const velocitiesMps = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    const theta = i * GOLDEN_ANGLE_RAD;
    const phi = Math.acos(1 - (2 * (i + 0.5)) / particleCount);
    const dirX = Math.sin(phi) * Math.cos(theta);
    const dirY = Math.abs(Math.cos(phi)); // biased upward-ish, reads more like a spark shower than a full sphere.
    const dirZ = Math.sin(phi) * Math.sin(theta);
    velocitiesMps[i * 3] = dirX * speedMps;
    velocitiesMps[i * 3 + 1] = dirY * speedMps;
    velocitiesMps[i * 3 + 2] = dirZ * speedMps;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: SPARK_COLOR_HEX, size: SPARK_SIZE_M, transparent: true, opacity: 1, depthWrite: false });
  const points = new THREE.Points(geometry, material);
  points.position.set(positionM.x, positionM.y, positionM.z);
  points.frustumCulled = false;

  return { points, velocitiesMps, ageS: 0, lifetimeS: SPARK_BASE_LIFETIME_S + magnitude * SPARK_MAX_EXTRA_LIFETIME_S };
}

/** Advances the burst by `dtS`, returns false once its lifetime has elapsed (caller should then remove/dispose it). */
export function updateSparkBurst(burst: ActiveSparkBurst, dtS: number): boolean {
  burst.ageS += dtS;
  const position = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const vxMps = burst.velocitiesMps[i * 3] ?? 0;
    const vyMps = (burst.velocitiesMps[i * 3 + 1] ?? 0) - SPARK_GRAVITY_MPS2 * dtS;
    const vzMps = burst.velocitiesMps[i * 3 + 2] ?? 0;
    burst.velocitiesMps[i * 3 + 1] = vyMps;
    position.setX(i, position.getX(i) + vxMps * dtS);
    position.setY(i, position.getY(i) + vyMps * dtS);
    position.setZ(i, position.getZ(i) + vzMps * dtS);
  }
  position.needsUpdate = true;

  const lifeFraction = Math.min(1, burst.ageS / burst.lifetimeS);
  (burst.points.material as THREE.PointsMaterial).opacity = 1 - lifeFraction;

  return burst.ageS < burst.lifetimeS;
}

export function disposeSparkBurst(burst: ActiveSparkBurst): void {
  burst.points.geometry.dispose();
  (burst.points.material as THREE.Material).dispose();
}
