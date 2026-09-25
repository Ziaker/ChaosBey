// ============================================================
// MILESTONE 2 — BASIC COMBAT MATCH SCENE
// Composes the arena and two Beys (first = player, second = temporary
// idle stand-in opponent — real AI is Milestone 7). Thin wiring only
// (GDD section 1.4); each Bey's systems still own their own logic.
// ============================================================

import * as THREE from 'three';
import { createArenaColliders } from '../../arena/colliders/createArenaColliders';
import { createBey, type Bey } from '../../bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../../bey/core/BeyTuning';
import { createBeyMesh, type BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';

// Opposite starting positions, facing each other — arbitrary, generous
// distance for a readable opening (arena radius is 12m).
const FIRST_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -4 };
const SECOND_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 4 };

export interface MatchScene {
  readonly first: Bey;
  readonly second: Bey;
  syncVisualsToPhysics(
    firstVisualSpinAngleRad: number,
    firstWobbleOffsetRad: number,
    secondVisualSpinAngleRad: number,
    secondWobbleOffsetRad: number,
  ): void;
}

function createSyncFn(body: Bey['body'], visual: BeyVisual) {
  const tiltQuaternion = new THREE.Quaternion();
  const wobbleQuaternion = new THREE.Quaternion();
  const wobbleAxis = new THREE.Vector3(1, 0, 0);
  return (visualSpinAngleRad: number, wobbleOffsetRad: number): void => {
    const t = body.translation();
    const r = body.rotation();
    visual.group.position.set(t.x, t.y, t.z);
    tiltQuaternion.set(r.x, r.y, r.z, r.w);
    wobbleQuaternion.setFromAxisAngle(wobbleAxis, wobbleOffsetRad);
    visual.group.quaternion.copy(tiltQuaternion).multiply(wobbleQuaternion);
    visual.spinGroup.rotation.y = visualSpinAngleRad;
  };
}

export function createMatchScene(scene: THREE.Scene, physics: PhysicsWorld): MatchScene {
  createArenaColliders(scene, physics);

  const first = createBey(physics, FIRST_SPAWN);
  const second = createBey(physics, SECOND_SPAWN);

  const firstVisual = createBeyMesh();
  const secondVisual = createBeyMesh();
  // Distinguishable at a glance for testing — not the approved archetype
  // visual identity (GDD section 96/97), purely a temporary debug cue.
  secondVisual.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial && obj.material.color.getHex() === 0x4fd1ff) {
      obj.material = obj.material.clone();
      obj.material.color.setHex(0xff6b6b);
      obj.material.emissive.setHex(0x4a0b0b);
    }
  });
  scene.add(firstVisual.group);
  scene.add(secondVisual.group);

  const syncFirst = createSyncFn(first.body, firstVisual);
  const syncSecond = createSyncFn(second.body, secondVisual);

  return {
    first,
    second,
    syncVisualsToPhysics: (firstSpin, firstWobble, secondSpin, secondWobble) => {
      syncFirst(firstSpin, firstWobble);
      syncSecond(secondSpin, secondWobble);
    },
  };
}
