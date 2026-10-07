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
import { ARENA_COLLISION_GROUPS } from '../../physics/collision/CollisionGroups';
import { BOWL_DEPTH_M, floorHeightAtRadius, floorRimHeight, type ArenaFloor } from '../floor/ArenaFloorProfile';
import { motionParams, motionRatio, surfaceColliderRestitution, type MotionParams } from '../../bey/motion/MotionPresets';
import { FOUNDRY_PIT, STANDARD_ARENA_GEOMETRY, type ArenaGeometry, type ArenaTheme } from '../presets/ArenaPresets';
import {
  ARENA_FLOOR_RADIUS,
  arenaFloorRadius,
  setArenaSizeScale,
  ARENA_FLOOR_THICKNESS,
  ARENA_WALL_SEGMENT_COUNT,
  ARENA_WALL_BOUNCE_MAX,
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
  motion: MotionParams = motionParams(),
): Arena {
  // Motion direction (M11, bey/motion/MotionPresets.ts): the wall keeps
  // the arena's own restitution (an M10 slider) scaled by the direction's
  // wall bounce relative to B, and its scrape friction likewise. The floor
  // collider does not bounce at all (restitution 0, MULTIPLY with the Bey):
  // the direction's floorBounce is the Motion Lab's landing bounce, applied
  // by MovementController on a real landing only — Rapier would also
  // bounce every rim contact of a rocking Bey, which at C's 0.55 pumped
  // the rocking until the cylinder lay on its side (measured).
  const floorRestitution = 0;
  const wallRestitution = surfaceColliderRestitution(Math.min(geometry.wallRestitution * motionRatio(motion, 'wallBounce'), ARENA_WALL_BOUNCE_MAX), motion);
  const wallFriction = WALL_MATERIAL.friction * motionRatio(motion, 'wallFriction');
  // The floor keeps the game's contact friction. The Motion Lab has none
  // (its drive alone slows a coasting Bey, at 0.6/s: an ~18 m glide from
  // top speed); here the contact friction also acts (~0.5 g: a released
  // Bey stops within ~1 s, and thrust nets ~9 m/s² of the 14), as the game
  // has always played — the Lab built B from the game's values, and the
  // owner's playtest note was that the Bey must not move by itself. The
  // long glide is an open option (docs/design-decisions/motion-approval.md §16).
  const floorMaterial = (desc: RAPIER.ColliderDesc) => desc.setRestitution(floorRestitution).setFriction(FLOOR_MATERIAL.friction * physics.frictionScale).setCollisionGroups(ARENA_COLLISION_GROUPS);
  // Lote 9 (item 3): the profile at the match's depth — the same h(r) as everything else that reads the floor.
  setArenaSizeScale(geometry.sizeScale ?? 1); // owner, 2026-10-04: the stage size slider
  const floor: ArenaFloor = { id: geometry.floor ?? 'flat', depthM: geometry.floorDepthM ?? BOWL_DEPTH_M };
  const profile = { heightAtRadius: (r: number) => floorHeightAtRadius(floor, r) };
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


  if (floor.id === 'flat' || floor.depthM <= 0) { // 0 m deep is the flat floor itself (Lote 9)
    const floorMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(arenaFloorRadius(), arenaFloorRadius(), ARENA_FLOOR_THICKNESS, ARENA_VISUAL_SEGMENTS),
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
      const r = (i / BOWL_VISUAL_RADIAL_STEPS) * arenaFloorRadius();
      points.push(new THREE.Vector2(r, profile.heightAtRadius(r)));
    }
    const bowlMesh = new THREE.Mesh(
      new THREE.LatheGeometry(points, ARENA_VISUAL_SEGMENTS),
      new THREE.MeshStandardMaterial({ color: theme.floorHex, roughness: theme.floorRoughness, metalness: theme.floorMetalness, side: THREE.DoubleSide }),
    );
    bowlMesh.name = `arena-floor-${floor}`;
    group.add(bowlMesh);
  }

  // Floor rings: purely painted markings, just above the floor surface
  // (on a bowl a ring of constant r is level, at h(r)).
  const lineMaterial = new THREE.MeshBasicMaterial({ color: theme.floorLineHex, transparent: true, opacity: theme.floorLineOpacity, depthWrite: false });
  for (const radius of [arenaFloorRadius() * 0.33, arenaFloorRadius() * 0.66, arenaFloorRadius() - 0.35]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.04, radius + 0.04, ARENA_VISUAL_SEGMENTS), lineMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = profile.heightAtRadius(radius) + 0.005;
    group.add(ring);
  }

  // Every floor, flat included, is a heightfield sampled from the same h(r) as
  // the visuals. The flat floor used to be one cylinder collider (radius =
  // arenaFloorRadius(), a thin slab centred at -THICKNESS/2 so its top is
  // y = 0); at the 3x arena (radius 36 m, 0.5 m thick) Rapier's
  // cylinder-vs-cylinder contact produced ghost obstacles for a rolling Bey
  // 1-2 m inside the wall (a full stop at r = 33.5-34.4 m, measured), which
  // the heightfield does not (arena scale pass). A flat heightfield is the
  // same plane (top y = 0) and, like the bowls, has no floor outside the wall.
  physics.rapierWorld.createCollider(
    floorMaterial(bowlHeightfield(profile.heightAtRadius)),
    physics.rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );

  const wallMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(
      arenaFloorRadius() + ARENA_WALL_THICKNESS / 2,
      arenaFloorRadius() + ARENA_WALL_THICKNESS / 2,
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
    new THREE.TorusGeometry(arenaFloorRadius() + ARENA_WALL_THICKNESS / 2, 0.05, 6, ARENA_VISUAL_SEGMENTS),
    new THREE.MeshBasicMaterial({ color: theme.rimHex }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = wallHeightM;
  group.add(rim);

  // The visual wall above is one open cylinder (cheap, seamless). Physics
  // needs discrete flat colliders instead, since Rapier has no native
  // "inside of a cylinder" shape that stays both cheap and robust — see
  // ArenaTuning.ts.
  const chordLength = 2 * arenaFloorRadius() * Math.sin(Math.PI / ARENA_WALL_SEGMENT_COUNT);
  const segmentHalfWidth = (chordLength * ARENA_WALL_SEGMENT_OVERLAP_FACTOR) / 2;
  const wallCollider = RAPIER.ColliderDesc.cuboid(segmentHalfWidth, wallHeightM / 2, ARENA_WALL_THICKNESS / 2)
    .setRestitution(wallRestitution)
    .setFriction(wallFriction)
    .setCollisionGroups(ARENA_COLLISION_GROUPS);

  for (let i = 0; i < ARENA_WALL_SEGMENT_COUNT; i++) {
    const angle = (i / ARENA_WALL_SEGMENT_COUNT) * Math.PI * 2;
    const x = Math.cos(angle) * arenaFloorRadius();
    const z = Math.sin(angle) * arenaFloorRadius();
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

/**
 * Heightfield resolution for the floor (cells per side): 144 = ~0.5 m cells
 * over the 72 m square. The arena scale pass first used 288 (~0.25 m, the old
 * 96-cell density at 3x the radius), but simulation cost grows with the cell
 * count: measured per AI-vs-AI tick 0.24 ms (72 cells), 0.30 (144), 0.36
 * (192), 0.46 (288) against 0.14 ms for the old 12 m flat arena, and CI's
 * accelerated Self Test fell under its 4x-real-time check at 288. The floor
 * is a smooth parabola (curvature 0.004 /m), so 0.5 m cells deviate from
 * h(r) by well under a millimetre.
 */
export const BOWL_HEIGHTFIELD_CELLS = 144;
/**
 * Visual lathe resolution along the radius. 72 steps (0.5 m) is plenty for the smooth
 * profile; the first scale pass used 144 x 288 segments (~83k triangles, 18x the old
 * floor), which slowed the software-rendered CI browser enough to make a timing-based
 * smoke test fail.
 */
const BOWL_VISUAL_RADIAL_STEPS = 72;
/** Segments around the bowl / rings / rim: 1.2 m each at r = 36 m, ~0.01 m sagitta. */
const ARENA_VISUAL_SEGMENTS = 192;
/**
 * Past the floor edge the heightfield drops this far below the rim: there
 * is no floor outside the arena (as with the flat floor, which ends at
 * arenaFloorRadius()), only behind the wall.
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
  const half = arenaFloorRadius() + (2 * arenaFloorRadius()) / n;
  const heights = new Float32Array((n + 1) * (n + 1));
  const rim = heightAtRadius(arenaFloorRadius());
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = -half + (2 * half * i) / n;
      const z = -half + (2 * half * j) / n;
      const r = Math.hypot(x, z);
      heights[i * (n + 1) + j] = r <= arenaFloorRadius() ? heightAtRadius(r) : rim - BOWL_OUTSIDE_DROP_M;
    }
  }
  return RAPIER.ColliderDesc.heightfield(n, n, heights, { x: 2 * half, y: 1, z: 2 * half }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES);
}
