// ============================================================
// MILESTONE 1 — PHYSICAL MOVEMENT PROTOTYPE SCENE
// Composes the arena, one temporary Bey, and its movement/spin/drift
// controllers. Thin wiring only — each controller owns its own logic
// (GDD section 1.4); this just assembles them and syncs the visual group
// to physics state each render frame.
// ============================================================

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { createArenaColliders } from '../../arena/colliders/createArenaColliders';
import { createBeyRigidBody } from '../../bey/core/BeyRigidBody';
import { BEY_SPAWN_HEIGHT_M } from '../../bey/core/BeyTuning';
import { MovementController } from '../../bey/movement/MovementController';
import { createBeyMesh } from '../../bey/procedural-model/createBeyMesh';
import { SpinController } from '../../bey/spin/SpinController';
import { DriftController } from '../../drift/DriftController';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';

export interface BeyPrototypeScene {
  readonly beyBody: RAPIER.RigidBody;
  readonly beyCollider: RAPIER.Collider;
  readonly movement: MovementController;
  readonly spin: SpinController;
  readonly drift: DriftController;
  syncVisualsToPhysics(visualSpinAngleRad: number, wobbleOffsetRad: number): void;
}

export function createBeyPrototypeScene(scene: THREE.Scene, physics: PhysicsWorld): BeyPrototypeScene {
  createArenaColliders(scene, physics);

  const { body, collider } = createBeyRigidBody(physics, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 });
  const beyVisual = createBeyMesh();
  scene.add(beyVisual.group);

  const tiltQuaternion = new THREE.Quaternion();
  const wobbleQuaternion = new THREE.Quaternion();
  const wobbleAxis = new THREE.Vector3(1, 0, 0);

  return {
    beyBody: body,
    beyCollider: collider,
    movement: new MovementController(),
    spin: new SpinController(),
    drift: new DriftController(),
    syncVisualsToPhysics: (visualSpinAngleRad: number, wobbleOffsetRad: number) => {
      const t = body.translation();
      const r = body.rotation();
      beyVisual.group.position.set(t.x, t.y, t.z);

      tiltQuaternion.set(r.x, r.y, r.z, r.w);
      wobbleQuaternion.setFromAxisAngle(wobbleAxis, wobbleOffsetRad);
      beyVisual.group.quaternion.copy(tiltQuaternion).multiply(wobbleQuaternion);

      beyVisual.spinGroup.rotation.y = visualSpinAngleRad;
    },
  };
}
