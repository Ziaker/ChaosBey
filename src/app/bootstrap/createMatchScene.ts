// ============================================================
// MILESTONE 2 — BASIC COMBAT MATCH SCENE
// Composes the arena and two Beys (first = player, second = temporary
// idle stand-in opponent — real AI is Milestone 7). Thin wiring only
// (GDD section 1.4); each Bey's systems still own their own logic.
// ============================================================

import * as THREE from 'three';
import { createArenaColliders } from '../../arena/colliders/createArenaColliders';
import { createBey, type Bey } from '../../bey/core/Bey';
import type { BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../bey/archetype/BeyArchetypes';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import { applyAttackProfileSettings, createDefaultAttackProfileSettings, type BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { FIRST_SPAWN, SECOND_SPAWN } from './matchSpawns';

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

/** Which Bey each side plays. */
export interface MatchBeys {
  readonly first: BeyDefinition;
  readonly second: BeyDefinition;
}

/**
 * The pairing used when nobody picked one (Debug Lab, quick play, tests):
 * Attack vs Defense, the M6 prototype pairing. M10's Character Select and
 * Pregame pick any of the three archetypes for either side.
 */
export const DEFAULT_MATCH_BEYS: MatchBeys = { first: ATTACK_ARCHETYPE, second: DEFENSE_ARCHETYPE };

export function createMatchScene(
  scene: THREE.Object3D,
  physics: PhysicsWorld,
  attackProfileSettings: BeyAttackProfileSettings = createDefaultAttackProfileSettings(),
  beys: MatchBeys = DEFAULT_MATCH_BEYS,
): MatchScene {
  createArenaColliders(scene, physics);

  const first = createBey(physics, FIRST_SPAWN, applyAttackProfileSettings(beys.first, attackProfileSettings));
  const second = createBey(physics, SECOND_SPAWN, applyAttackProfileSettings(beys.second, attackProfileSettings));

  const firstVisual = first.definition.appearance.createVisual();
  const secondVisual = second.definition.appearance.createVisual();
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
