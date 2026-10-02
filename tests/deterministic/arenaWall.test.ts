// ext-32 regression (M11 lane 3): the arena's edge wall must be a closed
// ring. The segments used to be rotated `angle + π/2` instead of
// `π/2 − angle`, which is only right on the four axes (the error is 2a):
// around ±45°/±135° they stood radially like fins with open gaps between
// them, so a Bey could slip into the wall, wedge between two segments, or
// leave the floor with no ring-out. These checks fail on that code.

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { createArenaColliders } from '../../src/arena/colliders/createArenaColliders';
import { ARENA_FLOOR_RADIUS, ARENA_WALL_SEGMENT_COUNT, ARENA_WALL_THICKNESS } from '../../src/arena/colliders/ArenaTuning';
import { createBeyRigidBody } from '../../src/bey/core/BeyRigidBody';
import { DEFAULT_PHYSICAL_PROFILE } from '../../src/bey/archetype/BeyPhysicalProfile';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';

const INNER_FACE_M = ARENA_FLOOR_RADIUS - ARENA_WALL_THICKNESS / 2;
/** A flat segment's inner face is farthest from the centre at its ends (plus the overlap). */
const MAX_INNER_M = Math.hypot(INNER_FACE_M, ARENA_FLOOR_RADIUS * Math.sin(Math.PI / ARENA_WALL_SEGMENT_COUNT) * 1.15);

async function arena(): Promise<PhysicsWorld> {
  const physics = await PhysicsWorld.create();
  createArenaColliders(new THREE.Scene(), physics);
  physics.rapierWorld.step(); // build the query pipeline
  return physics;
}

/** Thrown from 3 m inside the wall (9 m on the old 12 m arena). */
const START_RADIUS_M = ARENA_FLOOR_RADIUS - 3;

const isWall = (c: RAPIER.Collider): boolean => c.shape.type === RAPIER.ShapeType.Cuboid;

describe('arena wall collider (ext-32 regression)', () => {
  it('is a closed ring: from the centre, every direction hits the wall at the inner face', async () => {
    const physics = await arena();
    for (let deg = 0; deg < 360; deg += 0.5) {
      const a = (deg * Math.PI) / 180;
      for (const y of [0.2, 1, 1.8]) {
        const ray = new RAPIER.Ray({ x: 0, y, z: 0 }, { x: Math.cos(a), y: 0, z: Math.sin(a) });
        const hit = physics.rapierWorld.castRay(ray, ARENA_FLOOR_RADIUS + 2, true, undefined, undefined, undefined, undefined, isWall);
        expect(hit, `no wall at ${deg}°, y ${y}`).not.toBeNull();
        expect(hit!.timeOfImpact, `${deg}°`).toBeGreaterThanOrEqual(INNER_FACE_M - 1e-3);
        expect(hit!.timeOfImpact, `${deg}°`).toBeLessThanOrEqual(MAX_INNER_M + 1e-3);
      }
    }
    physics.rapierWorld.free();
  });

  it('every segment runs tangent to the circle (width along the tangent, thickness radial)', async () => {
    const physics = await arena();
    let segments = 0;
    physics.rapierWorld.forEachCollider((c) => {
      if (!isWall(c)) return;
      segments++;
      const p = c.translation();
      const q = c.rotation();
      const widthAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      const radial = new THREE.Vector3(p.x, 0, p.z).normalize();
      expect(Math.abs(widthAxis.dot(radial)), `segment at ${((Math.atan2(p.z, p.x) * 180) / Math.PI).toFixed(1)}°`).toBeLessThan(1e-6);
    });
    expect(segments).toBe(ARENA_WALL_SEGMENT_COUNT);
    physics.rapierWorld.free();
  });

  it('a Bey thrown outward at the old gap angles is stopped by the wall and stays on the floor', async () => {
    // 40°/50° (and their mirrors) were fully open; the others were jagged.
    for (const deg of [40, 45, 50, 130, 140, 220, 230, 310, 320, 0, 90]) {
      for (const [speed, startY, vy] of [
        [8, 0.3, 0],
        [15, 0.3, 0],
        [28, 0.3, 0], // the ext-0-sized counter launch
        [4.5, 1.2, -4.8], // the ext-32 trace: airborne, descending, drifting outward
      ] as const) {
        const physics = await arena();
        const a = (deg * Math.PI) / 180;
        const { body } = createBeyRigidBody(physics, { x: Math.cos(a) * START_RADIUS_M, y: startY, z: Math.sin(a) * START_RADIUS_M }, DEFAULT_PHYSICAL_PROFILE);
        body.setLinvel({ x: Math.cos(a) * speed, y: vy, z: Math.sin(a) * speed }, true);
        let maxR = 0;
        let minY = Infinity;
        for (let tick = 0; tick < 90; tick++) {
          physics.step();
          const p = body.translation();
          maxR = Math.max(maxR, Math.hypot(p.x, p.z));
          minY = Math.min(minY, p.y);
        }
        const label = `${deg}° at ${speed} m/s from y ${startY}`;
        // The Bey's centre never gets closer to the wall than its radius (plus solver slop), let alone into it.
        expect(maxR, label).toBeLessThan(INNER_FACE_M - DEFAULT_PHYSICAL_PROFILE.colliderRadiusM + 0.15);
        expect(minY, label).toBeGreaterThan(-0.05); // never through / off the floor
        const p = body.translation();
        expect(Math.hypot(p.x, p.z), `${label}: bounced back inside`).toBeLessThan(ARENA_FLOOR_RADIUS - 0.5);
        physics.rapierWorld.free();
      }
    }
  }, 60_000);
});
