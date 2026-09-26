// ============================================================
// BEY PHYSICAL PROFILE SELF-TESTS (MILESTONE 6, GDD section 6/31)
// Proves the per-archetype collider radius/half-height/mass are real data
// differences (not just visual), that createBeyRigidBody() actually wires
// them, and that a taller/shorter/heavier archetype still spawns, settles
// on the floor, and stays numerically stable exactly like the pre-M6
// default Bey — no archetype spawns buried or floating.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createArenaColliders } from '../../src/arena/colliders/createArenaColliders';
import { createBey } from '../../src/bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { DEFAULT_BEY_DEFINITION, type BeyDefinition } from '../../src/bey/archetype/BeyDefinition';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';

describe('BeyPhysicalProfile — per-archetype collider/mass differ purely from data', () => {
  it('the three archetypes have pairwise-distinct collider radius, half-height and mass from each other', () => {
    // Not compared against the default here: Stamina deliberately keeps
    // default mass (a "balanced" archetype), which is a legitimate design
    // choice, not a bug — the three archetypes still differ from each
    // other on every physical dimension.
    const profiles = [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE].map((d) => d.physical);

    expect(new Set(profiles.map((p) => p.colliderRadiusM)).size).toBe(3);
    expect(new Set(profiles.map((p) => p.colliderHalfHeightM)).size).toBe(3);
    expect(new Set(profiles.map((p) => p.massKg)).size).toBe(3);
  });

  it('every archetype differs from the default on at least one physical dimension', () => {
    const isDistinctFromDefault = (definition: BeyDefinition) => {
      const p = definition.physical;
      const d = DEFAULT_BEY_DEFINITION.physical;
      return p.colliderRadiusM !== d.colliderRadiusM || p.colliderHalfHeightM !== d.colliderHalfHeightM || p.massKg !== d.massKg;
    };

    expect(isDistinctFromDefault(ATTACK_ARCHETYPE)).toBe(true);
    expect(isDistinctFromDefault(DEFENSE_ARCHETYPE)).toBe(true);
    expect(isDistinctFromDefault(STAMINA_ARCHETYPE)).toBe(true);
  });

  it('createBeyRigidBody() actually applies each definition\'s physical profile to the real Rapier collider', async () => {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    createArenaColliders(scene, physics);

    const attackBey = createBey(physics, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 }, ATTACK_ARCHETYPE);
    const defenseBey = createBey(physics, { x: 4, y: BEY_SPAWN_HEIGHT_M, z: 0 }, DEFENSE_ARCHETYPE);

    expect(attackBey.collider.radius()).toBeCloseTo(ATTACK_ARCHETYPE.physical.colliderRadiusM);
    expect(attackBey.collider.halfHeight()).toBeCloseTo(ATTACK_ARCHETYPE.physical.colliderHalfHeightM);
    expect(attackBey.collider.mass()).toBeCloseTo(ATTACK_ARCHETYPE.physical.massKg);

    expect(defenseBey.collider.radius()).toBeCloseTo(DEFENSE_ARCHETYPE.physical.colliderRadiusM);
    expect(defenseBey.collider.halfHeight()).toBeCloseTo(DEFENSE_ARCHETYPE.physical.colliderHalfHeightM);
    expect(defenseBey.collider.mass()).toBeCloseTo(DEFENSE_ARCHETYPE.physical.massKg);
  });
});

describe('BeyPhysicalProfile — spawn/grounding settles correctly for every archetype (not buried, not floating)', () => {
  const cases: Array<[string, BeyDefinition]> = [
    ['default', DEFAULT_BEY_DEFINITION],
    ['attack', ATTACK_ARCHETYPE],
    ['defense', DEFENSE_ARCHETYPE],
    ['stamina', STAMINA_ARCHETYPE],
  ];

  for (const [label, definition] of cases) {
    it(`${label}: settles resting on the floor at a height matching its own collider half-height, staying numerically stable throughout`, async () => {
      const physics = await PhysicsWorld.create();
      const scene = new THREE.Scene();
      createArenaColliders(scene, physics);
      const bey = createBey(physics, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 }, definition);

      let finalY = 0;
      let sawGrounded = false;
      for (let i = 0; i < 120; i++) {
        physics.step();
        const t = bey.body.translation();
        const v = bey.body.linvel();
        expect(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)).toBe(true);
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
        finalY = t.y;
        if (isGrounded(physics, bey.collider)) sawGrounded = true;
      }

      expect(sawGrounded).toBe(true);
      // Same tolerance band as the pre-existing default-Bey "resting on the
      // floor" self-test (groundAndFloor.test.ts), just parameterized by
      // this archetype's own colliderHalfHeightM instead of the fixed
      // BEY_COLLIDER_HALF_HEIGHT_M constant.
      expect(finalY).toBeGreaterThan(definition.physical.colliderHalfHeightM - 0.05);
      expect(finalY).toBeLessThan(definition.physical.colliderHalfHeightM + 0.1);
    });
  }
});
