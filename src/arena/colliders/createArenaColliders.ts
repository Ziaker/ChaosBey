// ============================================================
// ARENA COLLIDERS — MILESTONE 1 TEMPORARY ARENA
// Builds the floor and a circular boundary wall (approximated by flat box
// segments) as static Rapier bodies, plus matching placeholder visuals.
// This is explicitly temporary engineering art (GDD section 1.6) — final
// arena shape/material/lighting requires the visual approval gate and
// pre-game preset/slider work (GDD section 36).
// ============================================================

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { FLOOR_MATERIAL, WALL_MATERIAL } from '../../physics/materials/PhysicsMaterials';
import { FOUNDRY_PIT, STANDARD_ARENA_GEOMETRY, type ArenaGeometry, type ArenaTheme } from '../presets/ArenaPresets';
import {
  ARENA_FLOOR_RADIUS,
  ARENA_FLOOR_THICKNESS,
  ARENA_WALL_SEGMENT_COUNT,
  ARENA_WALL_SEGMENT_OVERLAP_FACTOR,
  ARENA_WALL_THICKNESS,
} from './ArenaTuning';

export interface Arena {
  readonly group: THREE.Group;
}

/**
 * `geometry` is gameplay (wall height and bounce build the colliders; it
 * comes from MatchConfig). `theme` only paints the visuals; headless
 * worlds build into a detached scene and never draw it.
 */
export function createArenaColliders(
  scene: THREE.Object3D,
  physics: PhysicsWorld,
  geometry: ArenaGeometry = STANDARD_ARENA_GEOMETRY,
  theme: ArenaTheme = FOUNDRY_PIT.theme,
): Arena {
  const wallHeightM = geometry.wallHeightM;
  const group = new THREE.Group();
  scene.add(group);

  scene.add(new THREE.HemisphereLight(theme.skyHex, theme.groundHex, theme.hemisphereIntensity));
  const sun = new THREE.DirectionalLight(theme.sunHex, theme.sunIntensity);
  sun.position.set(5, 10, 3);
  scene.add(sun);

  // Backdrop: a large inside-out sphere in the theme's sky color, owned by this arena (removed with it).
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(200, 24, 12), new THREE.MeshBasicMaterial({ color: theme.backgroundHex, side: THREE.BackSide }));
  group.add(backdrop);

  const floorMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_FLOOR_RADIUS, ARENA_FLOOR_RADIUS, ARENA_FLOOR_THICKNESS, 48),
    new THREE.MeshStandardMaterial({ color: theme.floorHex, roughness: theme.floorRoughness, metalness: theme.floorMetalness }),
  );
  floorMesh.position.y = -ARENA_FLOOR_THICKNESS / 2;
  group.add(floorMesh);

  // Floor rings: purely painted markings, just above the floor surface.
  const lineMaterial = new THREE.MeshBasicMaterial({ color: theme.floorLineHex, transparent: true, opacity: theme.floorLineOpacity, depthWrite: false });
  for (const radius of [ARENA_FLOOR_RADIUS * 0.33, ARENA_FLOOR_RADIUS * 0.66, ARENA_FLOOR_RADIUS - 0.35]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.04, radius + 0.04, 96), lineMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    group.add(ring);
  }

  // Match the visual mesh exactly: its top surface is at y=0 (mesh center
  // at -THICKNESS/2, half-height THICKNESS/2). The collider must be
  // positioned the same way, not left at the body's default origin — the
  // Bey should never appear to float or sink relative to what's rendered.
  const floorBody = physics.rapierWorld.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -ARENA_FLOOR_THICKNESS / 2, 0),
  );
  physics.rapierWorld.createCollider(
    RAPIER.ColliderDesc.cylinder(ARENA_FLOOR_THICKNESS / 2, ARENA_FLOOR_RADIUS)
      .setRestitution(FLOOR_MATERIAL.restitution)
      .setFriction(FLOOR_MATERIAL.friction),
    floorBody,
  );

  const wallMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(
      ARENA_FLOOR_RADIUS + ARENA_WALL_THICKNESS / 2,
      ARENA_FLOOR_RADIUS + ARENA_WALL_THICKNESS / 2,
      wallHeightM,
      ARENA_WALL_SEGMENT_COUNT,
      1,
      true,
    ),
    new THREE.MeshStandardMaterial({
      color: theme.wallHex,
      roughness: 0.6,
      metalness: 0.3,
      side: THREE.DoubleSide,
      transparent: theme.wallOpacity < 1,
      opacity: theme.wallOpacity,
      depthWrite: theme.wallOpacity >= 1,
    }),
  );
  wallMesh.position.y = wallHeightM / 2;
  group.add(wallMesh);

  // Emissive trim along the top of the wall: shows where the rim is at a glance.
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(ARENA_FLOOR_RADIUS + ARENA_WALL_THICKNESS / 2, 0.05, 6, 96),
    new THREE.MeshBasicMaterial({ color: theme.rimHex }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = wallHeightM;
  group.add(rim);

  // The visual wall above is one open cylinder (cheap, seamless). Physics
  // needs discrete flat colliders instead, since Rapier has no native
  // "inside of a cylinder" shape that stays both cheap and robust — see
  // ArenaTuning.ts.
  const chordLength = 2 * ARENA_FLOOR_RADIUS * Math.sin(Math.PI / ARENA_WALL_SEGMENT_COUNT);
  const segmentHalfWidth = (chordLength * ARENA_WALL_SEGMENT_OVERLAP_FACTOR) / 2;
  const wallCollider = RAPIER.ColliderDesc.cuboid(segmentHalfWidth, wallHeightM / 2, ARENA_WALL_THICKNESS / 2)
    .setRestitution(geometry.wallRestitution)
    .setFriction(WALL_MATERIAL.friction);

  for (let i = 0; i < ARENA_WALL_SEGMENT_COUNT; i++) {
    const angle = (i / ARENA_WALL_SEGMENT_COUNT) * Math.PI * 2;
    const x = Math.cos(angle) * ARENA_FLOOR_RADIUS;
    const z = Math.sin(angle) * ARENA_FLOOR_RADIUS;
    // Segment's local X axis (its width) must run tangent to the circle at this angle.
    const tangentYaw = angle + Math.PI / 2;

    const segmentBody = physics.rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, wallHeightM / 2, z)
        .setRotation({ x: 0, y: Math.sin(tangentYaw / 2), z: 0, w: Math.cos(tangentYaw / 2) }),
    );
    physics.rapierWorld.createCollider(wallCollider, segmentBody);
  }

  return { group };
}
