// ============================================================
// PROCEDURAL BEY MESH — TEMPORARY ENGINEERING VISUAL
// Explicitly placeholder art (GDD section 1.6), not the approved Bey
// visual design (that needs prototypes + approval per GDD section 96/97).
// Exists to make spin/tilt/wobble/impact behavior visible for testing.
//
// Two-group structure per GDD section 17/83: `group` carries the
// physics-derived position + tilt + wobble; `spinGroup` (its child) is
// rotated purely from the decoupled visual spin value and never touches
// physics. A plain symmetric cylinder wouldn't visibly read as "spinning"
// at all, so a small off-center marker is added to the spin layer.
// ============================================================

import * as THREE from 'three';
import { BEY_COLLIDER_HALF_HEIGHT_M, BEY_COLLIDER_RADIUS_M } from '../core/BeyTuning';

export interface BeyVisual {
  readonly group: THREE.Group;
  readonly spinGroup: THREE.Group;
}

export function createBeyMesh(): BeyVisual {
  const group = new THREE.Group();
  const spinGroup = new THREE.Group();
  group.add(spinGroup);

  const bodyMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(BEY_COLLIDER_RADIUS_M, BEY_COLLIDER_RADIUS_M * 0.75, BEY_COLLIDER_HALF_HEIGHT_M * 2, 28),
    new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x0b3a4a, roughness: 0.4, metalness: 0.6 }),
  );
  spinGroup.add(bodyMesh);

  // Visible marker so the fast continuous spin actually reads on screen.
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, BEY_COLLIDER_HALF_HEIGHT_M * 2.1, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0x554400 }),
  );
  marker.position.set(BEY_COLLIDER_RADIUS_M * 0.8, 0, 0);
  spinGroup.add(marker);

  return { group, spinGroup };
}
