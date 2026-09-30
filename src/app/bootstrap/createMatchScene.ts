// ============================================================
// MILESTONE 2 — BASIC COMBAT MATCH SCENE
// Composes the arena and two Beys (first = player, second = temporary
// idle stand-in opponent — real AI is Milestone 7). Thin wiring only
// (GDD section 1.4); each Bey's systems still own their own logic.
// ============================================================

import * as THREE from 'three';
import { createArenaColliders } from '../../arena/colliders/createArenaColliders';
import { FOUNDRY_PIT, STANDARD_ARENA_GEOMETRY, type ArenaGeometry, type ArenaTheme } from '../../arena/presets/ArenaPresets';
import { createBey, type Bey } from '../../bey/core/Bey';
import { motionParams, type MotionDirectionId } from '../../bey/motion/MotionPresets';
import type { Vec2 } from '../../physics/Vec2';
import type { BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../bey/archetype/BeyArchetypes';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import { applyAttackProfileSettings, createDefaultAttackProfileSettings, type BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { matchSpawnsFor } from './matchSpawns';

export interface MatchScene {
  readonly first: Bey;
  readonly second: Bey;
  syncVisualsToPhysics(first: BeyVisualPose, second: BeyVisualPose): void;
}

/** What the render adds on top of the physics body's pose: the visual spin, the wobble and the Motion Lab lean (all visual-only). */
export interface BeyVisualPose {
  readonly spin: number;
  readonly wobble: number;
  /** Which way the top leans (world XZ), magnitude = angle (rad). */
  readonly lean: Vec2;
}

export const REST_VISUAL_POSE: BeyVisualPose = { spin: 0, wobble: 0, lean: { x: 0, z: 0 } };

function createSyncFn(body: Bey['body'], visual: BeyVisual) {
  const tiltQuaternion = new THREE.Quaternion();
  const wobbleQuaternion = new THREE.Quaternion();
  const wobbleAxis = new THREE.Vector3(1, 0, 0);
  const leanQuaternion = new THREE.Quaternion();
  const leanAxis = new THREE.Vector3();
  return (pose: BeyVisualPose): void => {
    const t = body.translation();
    const r = body.rotation();
    visual.group.position.set(t.x, t.y, t.z);
    tiltQuaternion.set(r.x, r.y, r.z, r.w);
    wobbleQuaternion.setFromAxisAngle(wobbleAxis, pose.wobble);
    // Lean toward (dx, dz) by angle a: rotate about up × dir = (dz, 0, −dx), in world space (applied first).
    const leanAngle = Math.hypot(pose.lean.x, pose.lean.z);
    if (leanAngle > 1e-6) leanQuaternion.setFromAxisAngle(leanAxis.set(pose.lean.z / leanAngle, 0, -pose.lean.x / leanAngle), leanAngle);
    else leanQuaternion.identity();
    visual.group.quaternion.copy(leanQuaternion).multiply(tiltQuaternion).multiply(wobbleQuaternion);
    visual.spinGroup.rotation.y = pose.spin;
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

/** The arena a match is built in: gameplay geometry (from MatchConfig) and a render-only theme. */
export interface MatchArena {
  readonly geometry: ArenaGeometry;
  readonly theme: ArenaTheme;
}

export function createMatchScene(
  scene: THREE.Object3D,
  physics: PhysicsWorld,
  attackProfileSettings: BeyAttackProfileSettings = createDefaultAttackProfileSettings(),
  beys: MatchBeys = DEFAULT_MATCH_BEYS,
  arena: MatchArena = { geometry: STANDARD_ARENA_GEOMETRY, theme: FOUNDRY_PIT.theme },
  motion: MotionDirectionId = 'B',
): MatchScene {
  const motionValues = motionParams(motion);
  createArenaColliders(scene, physics, arena.geometry, arena.theme, motionValues);

  const floor = arena.geometry.floor ?? 'flat';
  const spawns = matchSpawnsFor(floor);
  const first = createBey(physics, spawns.first, applyAttackProfileSettings(beys.first, attackProfileSettings), floor, motionValues);
  const second = createBey(physics, spawns.second, applyAttackProfileSettings(beys.second, attackProfileSettings), floor, motionValues);

  const firstVisual = first.definition.appearance.createVisual();
  const secondVisual = second.definition.appearance.createVisual();
  scene.add(firstVisual.group);
  scene.add(secondVisual.group);

  const syncFirst = createSyncFn(first.body, firstVisual);
  const syncSecond = createSyncFn(second.body, secondVisual);

  return {
    first,
    second,
    syncVisualsToPhysics: (firstPose, secondPose) => {
      syncFirst(firstPose);
      syncSecond(secondPose);
    },
  };
}
