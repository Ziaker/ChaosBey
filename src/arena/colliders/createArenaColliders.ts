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
import { ARENA_FLOORS, floorRimHeight, type ArenaFloorId } from '../floor/ArenaFloorProfile';
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
  const floor: ArenaFloorId = geometry.floor ?? 'flat';
  const profile = ARENA_FLOORS[floor];
  // The wall is measured from the rim (visual-prototypes-approval.md §2.3):
  // it runs from y = 0 up to rim + wall height, so on a bowl its inner face
  // still covers the floor all the way up to the edge. Flat: rim = 0, as before.
  const rimM = floorRimHeight(floor);
  const wallHeightM = rimM + geometry.wallHeightM;
  const group = new THREE.Group();
  scene.add(group);

  scene.add(new THREE.HemisphereLight(theme.skyHex, theme.groundHex, theme.hemisphereIntensity));
  const sun = new THREE.DirectionalLight(theme.sunHex, theme.sunIntensity);
  sun.position.set(5, 10, 3);
  scene.add(sun);


  if (floor === 'flat') {
    const floorMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_FLOOR_RADIUS, ARENA_FLOOR_RADIUS, ARENA_FLOOR_THICKNESS, 48),
      new THREE.MeshStandardMaterial({ color: theme.floorHex, roughness: theme.floorRoughness, metalness: theme.floorMetalness }),
    );
    floorMesh.position.y = -ARENA_FLOOR_THICKNESS / 2;
    group.add(floorMesh);
  } else {
    // TEMPORARY bowl visual (M11 playtest): the approved profile turned on a
    // lathe, painted with the current theme's floor material. The approved
    // arena art (prototypes/arena-visual-concepts) is not integrated yet.
    const points: THREE.Vector2[] = [];
    for (let i = 0; i <= BOWL_VISUAL_RADIAL_STEPS; i++) {
      const r = (i / BOWL_VISUAL_RADIAL_STEPS) * ARENA_FLOOR_RADIUS;
      points.push(new THREE.Vector2(r, profile.heightAtRadius(r)));
    }
    const bowlMesh = new THREE.Mesh(
      new THREE.LatheGeometry(points, 96),
      new THREE.MeshStandardMaterial({ color: theme.floorHex, roughness: theme.floorRoughness, metalness: theme.floorMetalness, side: THREE.DoubleSide }),
    );
    bowlMesh.name = `arena-floor-${floor}`;
    group.add(bowlMesh);
  }

  // Floor rings: purely painted markings, just above the floor surface
  // (on a bowl a ring of constant r is level, at h(r)).
  const lineMaterial = new THREE.MeshBasicMaterial({ color: theme.floorLineHex, transparent: true, opacity: theme.floorLineOpacity, depthWrite: false });
  for (const radius of [ARENA_FLOOR_RADIUS * 0.33, ARENA_FLOOR_RADIUS * 0.66, ARENA_FLOOR_RADIUS - 0.35]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.04, radius + 0.04, 96), lineMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = profile.heightAtRadius(radius) + 0.005;
    group.add(ring);
  }

  if (floor === 'flat') {
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
  } else {
    physics.rapierWorld.createCollider(
      bowlHeightfield(profile.heightAtRadius).setRestitution(FLOOR_MATERIAL.restitution).setFriction(FLOOR_MATERIAL.friction),
      physics.rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
    );
  }

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
    // Segment's local X axis (its width) must run tangent to the circle at
    // this angle, and its local Z (thickness) radially. A yaw θ about +Y maps
    // local X to (cos θ, 0, −sin θ); the tangent at (cos a, 0, sin a) is
    // parallel to (sin a, 0, −cos a), so θ = π/2 − a. (ext-32: this was
    // `a + π/2`, which is only right on the four axes — the error is 2a —
    // so around ±45°/±135° the segments stood radially like fins with open
    // gaps between them: a Bey could slip through, wedge between two
    // segments, or end up past the floor edge and fall with no ring-out.)
    const tangentYaw = Math.PI / 2 - angle;

    const segmentBody = physics.rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, wallHeightM / 2, z)
        .setRotation({ x: 0, y: Math.sin(tangentYaw / 2), z: 0, w: Math.cos(tangentYaw / 2) }),
    );
    physics.rapierWorld.createCollider(wallCollider, segmentBody);
  }

  return { group };
}

/** Heightfield resolution for a bowl floor (cells per side). ~0.26 m cells for a 0.6 m-radius Bey. */
export const BOWL_HEIGHTFIELD_CELLS = 96;
/** Visual lathe resolution along the radius. */
const BOWL_VISUAL_RADIAL_STEPS = 48;
/**
 * Past the floor edge the heightfield drops this far below the rim: there
 * is no floor outside the arena (as with the flat floor, which ends at
 * ARENA_FLOOR_RADIUS), only behind the wall.
 */
const BOWL_OUTSIDE_DROP_M = 8;

/**
 * The concave floor collider: a square Rapier heightfield centred on the
 * arena, sampled from the same h(r) as the visuals (one source of truth).
 * The profile is radially symmetric, so the grid's row/column order does
 * not matter. FIX_INTERNAL_EDGES keeps a Bey rolling across triangle edges
 * from catching on them.
 */
function bowlHeightfield(heightAtRadius: (r: number) => number): RAPIER.ColliderDesc {
  const n = BOWL_HEIGHTFIELD_CELLS;
  const half = ARENA_FLOOR_RADIUS + (2 * ARENA_FLOOR_RADIUS) / n;
  const heights = new Float32Array((n + 1) * (n + 1));
  const rim = heightAtRadius(ARENA_FLOOR_RADIUS);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = -half + (2 * half * i) / n;
      const z = -half + (2 * half * j) / n;
      const r = Math.hypot(x, z);
      heights[i * (n + 1) + j] = r <= ARENA_FLOOR_RADIUS ? heightAtRadius(r) : rim - BOWL_OUTSIDE_DROP_M;
    }
  }
  return RAPIER.ColliderDesc.heightfield(n, n, heights, { x: 2 * half, y: 1, z: 2 * half }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES);
}
