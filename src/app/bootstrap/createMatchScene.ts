// ============================================================
// MILESTONE 2 — BASIC COMBAT MATCH SCENE
// Composes the arena and two Beys (first = player, second = temporary
// idle stand-in opponent — real AI is Milestone 7). Thin wiring only
// (GDD section 1.4); each Bey's systems still own their own logic.
// ============================================================

import { realSecondSpinDir } from '../../bey/real/realTunings';
import { BOWL_DEPTH_M, type ArenaFloor } from '../../arena/floor/ArenaFloorProfile';
import { beyMatchRulesOf, createDefaultMatchConfig, type BeyMatchRules } from '../../config/match/MatchConfig';
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
import { beyVisualDefinitionFor } from '../../bey/visual/approvedBeyVisuals';
import { BeyVisualAnchors, type BeyVisualDefinition } from '../../presentation/beyVisual';
import { PRESENTATION_FEATURES_OFF, type PresentationFeatures } from '../../presentation/features';
import { matchSpawnsFor } from './matchSpawns';
import { arenaFloorRadius } from '../../arena/colliders/ArenaTuning';
import type { RailDefinition } from '../../arena/rails/RailBlueprint';
import { railsOfMatch } from '../../arena/rails/StageRails';

/** Which visual one Bey wears and where effects attach to it (presentation only). */
export interface BeyVisualHandle {
  readonly definition: BeyVisualDefinition;
  readonly anchors: BeyVisualAnchors;
  /** The built visual (two groups), for presentation systems that dress it. Never reaches the body. */
  readonly visual: BeyVisual;
}

export interface MatchScene {
  readonly first: Bey;
  readonly second: Bey;
  /** Rail Grinding: the rails of this match's stage (empty when the Pregame option is off). */
  readonly rails: readonly RailDefinition[];
  /** Presentation-only: the visual each Bey wears and its VFX anchors. */
  readonly visuals: { readonly first: BeyVisualHandle; readonly second: BeyVisualHandle };
  syncVisualsToPhysics(first: BeyVisualPose, second: BeyVisualPose): void;
}

/** What the render adds on top of the physics body's pose: the visual spin, the wobble and the Motion Lab lean (all visual-only). */
export interface BeyVisualPose {
  readonly spin: number;
  readonly wobble: number;
  /** Which way the top leans (world XZ), magnitude = angle (rad). */
  readonly lean: Vec2;
  /** Owner, 2026-10-04: a Bey launched high tumbles on several axes (angle rad about a horizontal axis). Visual only. */
  readonly tumble?: { readonly angle: number; readonly axis: Vec2 };
}

export const REST_VISUAL_POSE: BeyVisualPose = { spin: 0, wobble: 0, lean: { x: 0, z: 0 } };

function createSyncFn(body: Bey['body'], visual: BeyVisual) {
  const tiltQuaternion = new THREE.Quaternion();
  const wobbleQuaternion = new THREE.Quaternion();
  const wobbleAxis = new THREE.Vector3(1, 0, 0);
  const leanQuaternion = new THREE.Quaternion();
  const leanAxis = new THREE.Vector3();
  const tumbleQuaternion = new THREE.Quaternion();
  const tumbleAxis = new THREE.Vector3();
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
    if (pose.tumble && Math.abs(pose.tumble.angle) > 1e-4) tumbleQuaternion.setFromAxisAngle(tumbleAxis.set(pose.tumble.axis.x, 0, pose.tumble.axis.z), pose.tumble.angle);
    else tumbleQuaternion.identity();
    visual.group.quaternion.copy(tumbleQuaternion).multiply(leanQuaternion).multiply(tiltQuaternion).multiply(wobbleQuaternion);
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

/** A hidden group in the scene that takes the temporary arena visuals the approved art replaces. Invisible, so its lights and meshes are not drawn. */
function discardedVisualHolder(scene: THREE.Object3D): THREE.Group {
  const holder = new THREE.Group();
  holder.name = 'discarded-temporary-arena-visuals';
  holder.visible = false;
  scene.add(holder);
  return holder;
}

export function createMatchScene(
  scene: THREE.Object3D,
  physics: PhysicsWorld,
  attackProfileSettings: BeyAttackProfileSettings = createDefaultAttackProfileSettings(),
  beys: MatchBeys = DEFAULT_MATCH_BEYS,
  arena: MatchArena = { geometry: STANDARD_ARENA_GEOMETRY, theme: FOUNDRY_PIT.theme },
  motion: MotionDirectionId = 'B',
  features: PresentationFeatures = PRESENTATION_FEATURES_OFF,
  rules: BeyMatchRules = beyMatchRulesOf(createDefaultMatchConfig()),
): MatchScene {
  const motionValues = motionParams(motion);
  // arenaVisuals: createArenaColliders builds the colliders AND its temporary visuals (floor, wall, rings, two lights) in one call, and it is
  // left exactly as it is. With the flag on, those temporary visuals go to a hidden holder (never drawn, freed with the session) and the
  // approved arena art is built separately by the presentation system. Flag off: the same call on the same scene as always.
  createArenaColliders(features.arenaVisuals ? discardedVisualHolder(scene) : scene, physics, arena.geometry, arena.theme, motionValues);

  const floor: ArenaFloor = { id: arena.geometry.floor ?? 'flat', depthM: arena.geometry.floorDepthM ?? BOWL_DEPTH_M }; // Lote 9: profile + depth
  const spawns = matchSpawnsFor(floor);
  const firstBase = applyAttackProfileSettings(beys.first, attackProfileSettings);
  const secondBase = applyAttackProfileSettings(beys.second, attackProfileSettings);
  const rails = railsOfMatch(rules.railsEnabled ?? false, floor, arenaFloorRadius());
  const first = createBey(physics, spawns.first, firstBase, floor, motionValues, rules, rails, 1);
  const second = createBey(physics, spawns.second, secondBase, floor, motionValues, rules, rails, rules.real ? realSecondSpinDir(rules.real) : -1);

  // The same resolution Character Select's preview uses (beyVisualDefinitionFor):
  // the approved concept with `newBeyVisuals` on, the legacy placeholder
  // (`definition.appearance.createVisual()`) with it off. The visual never
  // reaches the body or the stats.
  const firstVisualDefinition = beyVisualDefinitionFor(first.definition, features);
  const secondVisualDefinition = beyVisualDefinitionFor(second.definition, features);
  // Owner, 2026-10-05 (MatchConfig.beySizeScale): the model is built at its designed size and its group scaled, so it
  // matches the scaled body (the model's own offsets scale with it).
  const firstVisual = firstVisualDefinition.create(firstBase);
  const secondVisual = secondVisualDefinition.create(secondBase);
  firstVisual.group.scale.setScalar(first.definition.sizeScale ?? 1);
  secondVisual.group.scale.setScalar(second.definition.sizeScale ?? 1);
  const visuals = {
    first: { definition: firstVisualDefinition, anchors: new BeyVisualAnchors(firstVisual, firstVisualDefinition.anchors), visual: firstVisual },
    second: { definition: secondVisualDefinition, anchors: new BeyVisualAnchors(secondVisual, secondVisualDefinition.anchors), visual: secondVisual },
  };
  scene.add(firstVisual.group);
  scene.add(secondVisual.group);

  const syncFirst = createSyncFn(first.body, firstVisual);
  const syncSecond = createSyncFn(second.body, secondVisual);

  return {
    first,
    second,
    rails,
    visuals,
    syncVisualsToPhysics: (firstPose, secondPose) => {
      syncFirst(firstPose);
      syncSecond(secondPose);
    },
  };
}
