// ============================================================
// MILESTONE 0 SANDBOX SCENE — TEMPORARY ENGINEERING VISUAL
// Proves the render + physics path with a floor and a single dynamic body.
// This is explicitly placeholder art, not the approved arena/Bey visual
// design (GDD section 1.6). It exists only to validate Milestone 0's
// acceptance criteria: "app loads, scene renders".
// ============================================================

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';

const FLOOR_RADIUS = 8;
const FLOOR_THICKNESS = 0.5;
const PLACEHOLDER_BODY_RADIUS = 0.6;
const PLACEHOLDER_BODY_HEIGHT = 0.4;
const PLACEHOLDER_BODY_DROP_HEIGHT = 5;

export interface SandboxScene {
  readonly placeholderMesh: THREE.Object3D;
  readonly placeholderBody: RAPIER.RigidBody;
  syncVisualsToPhysics: () => void;
}

export function createSandboxScene(scene: THREE.Scene, physics: PhysicsWorld): SandboxScene {
  scene.add(new THREE.HemisphereLight(0x8090ff, 0x101018, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(5, 10, 3);
  scene.add(sun);

  const floorMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(FLOOR_RADIUS, FLOOR_RADIUS, FLOOR_THICKNESS, 48),
    new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.9 }),
  );
  floorMesh.position.y = -FLOOR_THICKNESS / 2;
  scene.add(floorMesh);

  const floorBody = physics.rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  physics.rapierWorld.createCollider(
    RAPIER.ColliderDesc.cylinder(FLOOR_THICKNESS / 2, FLOOR_RADIUS),
    floorBody,
  );

  const placeholderMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(PLACEHOLDER_BODY_RADIUS, PLACEHOLDER_BODY_RADIUS * 0.8, PLACEHOLDER_BODY_HEIGHT, 24),
    new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x0b3a4a, roughness: 0.4, metalness: 0.6 }),
  );
  scene.add(placeholderMesh);

  const placeholderBody = physics.rapierWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, PLACEHOLDER_BODY_DROP_HEIGHT, 0),
  );
  physics.rapierWorld.createCollider(
    RAPIER.ColliderDesc.cylinder(PLACEHOLDER_BODY_HEIGHT / 2, PLACEHOLDER_BODY_RADIUS).setRestitution(0.4),
    placeholderBody,
  );

  return {
    placeholderMesh,
    placeholderBody,
    syncVisualsToPhysics: () => {
      const t = placeholderBody.translation();
      const r = placeholderBody.rotation();
      placeholderMesh.position.set(t.x, t.y, t.z);
      placeholderMesh.quaternion.set(r.x, r.y, r.z, r.w);
    },
  };
}
