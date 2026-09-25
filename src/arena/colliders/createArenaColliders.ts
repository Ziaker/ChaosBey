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
import {
  ARENA_FLOOR_RADIUS,
  ARENA_FLOOR_THICKNESS,
  ARENA_WALL_HEIGHT,
  ARENA_WALL_SEGMENT_COUNT,
  ARENA_WALL_SEGMENT_OVERLAP_FACTOR,
  ARENA_WALL_THICKNESS,
} from './ArenaTuning';

export interface Arena {
  readonly group: THREE.Group;
}

export function createArenaColliders(scene: THREE.Scene, physics: PhysicsWorld): Arena {
  const group = new THREE.Group();
  scene.add(group);

  scene.add(new THREE.HemisphereLight(0x8090ff, 0x101018, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(5, 10, 3);
  scene.add(sun);

  const floorMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_FLOOR_RADIUS, ARENA_FLOOR_RADIUS, ARENA_FLOOR_THICKNESS, 48),
    new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.9 }),
  );
  floorMesh.position.y = -ARENA_FLOOR_THICKNESS / 2;
  group.add(floorMesh);

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
      ARENA_WALL_HEIGHT,
      ARENA_WALL_SEGMENT_COUNT,
      1,
      true,
    ),
    new THREE.MeshStandardMaterial({ color: 0x33384a, roughness: 0.8, side: THREE.DoubleSide }),
  );
  wallMesh.position.y = ARENA_WALL_HEIGHT / 2;
  group.add(wallMesh);

  // The visual wall above is one open cylinder (cheap, seamless). Physics
  // needs discrete flat colliders instead, since Rapier has no native
  // "inside of a cylinder" shape that stays both cheap and robust — see
  // ArenaTuning.ts.
  const chordLength = 2 * ARENA_FLOOR_RADIUS * Math.sin(Math.PI / ARENA_WALL_SEGMENT_COUNT);
  const segmentHalfWidth = (chordLength * ARENA_WALL_SEGMENT_OVERLAP_FACTOR) / 2;
  const wallCollider = RAPIER.ColliderDesc.cuboid(segmentHalfWidth, ARENA_WALL_HEIGHT / 2, ARENA_WALL_THICKNESS / 2)
    .setRestitution(WALL_MATERIAL.restitution)
    .setFriction(WALL_MATERIAL.friction);

  for (let i = 0; i < ARENA_WALL_SEGMENT_COUNT; i++) {
    const angle = (i / ARENA_WALL_SEGMENT_COUNT) * Math.PI * 2;
    const x = Math.cos(angle) * ARENA_FLOOR_RADIUS;
    const z = Math.sin(angle) * ARENA_FLOOR_RADIUS;
    // Segment's local X axis (its width) must run tangent to the circle at this angle.
    const tangentYaw = angle + Math.PI / 2;

    const segmentBody = physics.rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, ARENA_WALL_HEIGHT / 2, z)
        .setRotation({ x: 0, y: Math.sin(tangentYaw / 2), z: 0, w: Math.cos(tangentYaw / 2) }),
    );
    physics.rapierWorld.createCollider(wallCollider, segmentBody);
  }

  return { group };
}
