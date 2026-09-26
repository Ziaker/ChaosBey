// ============================================================
// MILESTONE 6 — ARCHETYPE DATA-DRIVEN DIFFERENTIATION SELF-TESTS
// Proves the three prototype BeyDefinitions (BeyArchetypes.ts) produce
// measurably different movement/knockback/Stamina behavior purely from
// data, with the underlying MovementController/BeyRigidBody/StaminaSystem
// formulas themselves unchanged (GDD section 6/31) — the same real
// controllers every other milestone's self-tests exercise, not a
// simplified stand-in (GDD section 114).
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createArenaColliders } from '../../src/arena/colliders/createArenaColliders';
import { createBey } from '../../src/bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { DEFAULT_BEY_DEFINITION, type BeyDefinition } from '../../src/bey/archetype/BeyDefinition';
import type { BeyHandlingProfile } from '../../src/bey/archetype/BeyHandlingProfile';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { Action } from '../../src/input/actions/Action';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';

const SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 };

/** Same mass/stats as the default archetype, varying only Handling — isolates the movement-feel axis from the mass-driven collision response the next describe block tests separately. */
function withHandling(handling: BeyHandlingProfile): BeyDefinition {
  return { ...DEFAULT_BEY_DEFINITION, handling };
}

describe('archetype handling profiles (GDD section 6/31)', () => {
  it('the Attack prototype reaches a higher top speed than the Defense prototype under identical input', async () => {
    async function finalSpeedFor(definition: BeyDefinition): Promise<number> {
      const physics = await PhysicsWorld.create();
      const scene = new THREE.Scene();
      createArenaColliders(scene, physics);
      const bey = createBey(physics, SPAWN, definition);
      const controller = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);

      // Short enough that neither profile's higher top speed carries it
      // into the arena wall (12m radius) within this window — a wall
      // bounce would otherwise dominate the comparison with an unrelated
      // collision-response artifact instead of the handling difference
      // this test isolates.
      let speed = 0;
      for (let i = 0; i < 60; i++) {
        const actions = controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
        bey.movement.applyPreStep(bey.body, {
          actions,
          fixedDeltaSeconds: FIXED_DELTA_SECONDS,
          grounded: true,
          lateralGripOverridePerS: null,
          staminaAccelFactor: 1,
          dashOverride: null,
        });
        physics.step();
        speed = bey.movement.postStep(bey.body, true).speedMps;
      }
      return speed;
    }

    const attackSpeed = await finalSpeedFor(withHandling(ATTACK_ARCHETYPE.handling));
    const defenseSpeed = await finalSpeedFor(withHandling(DEFENSE_ARCHETYPE.handling));

    expect(attackSpeed).toBeGreaterThan(defenseSpeed);
  });
});

describe('archetype mass (GDD section 6/31, BeyRigidBody)', () => {
  it('the same impulse displaces the lighter Attack prototype faster than the heavier Defense prototype', async () => {
    async function speedAfterImpulse(definition: BeyDefinition): Promise<number> {
      const physics = await PhysicsWorld.create();
      const scene = new THREE.Scene();
      createArenaColliders(scene, physics);
      const bey = createBey(physics, SPAWN, definition);

      bey.body.applyImpulse({ x: 0, y: 0, z: 5 }, true);
      physics.step();
      const v = bey.body.linvel();
      return Math.hypot(v.x, v.z);
    }

    const attackResultSpeed = await speedAfterImpulse(ATTACK_ARCHETYPE);
    const defenseResultSpeed = await speedAfterImpulse(DEFENSE_ARCHETYPE);

    expect(attackResultSpeed).toBeGreaterThan(defenseResultSpeed);
  });
});

describe('archetype Stamina stat (GDD section 6/31, StaminaSystem)', () => {
  it('gives the Stamina prototype a larger max pool and slower drain than the default archetype', async () => {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    createArenaColliders(scene, physics);
    const staminaBey = createBey(physics, SPAWN, STAMINA_ARCHETYPE);
    const defaultBey = createBey(physics, { x: 4, y: BEY_SPAWN_HEIGHT_M, z: 0 }, DEFAULT_BEY_DEFINITION);

    expect(staminaBey.stamina.resource.max).toBeGreaterThan(defaultBey.stamina.resource.max);

    for (let i = 0; i < 300; i++) {
      staminaBey.stamina.tick(10, FIXED_DELTA_SECONDS);
      defaultBey.stamina.tick(10, FIXED_DELTA_SECONDS);
    }

    expect(staminaBey.stamina.resource.fraction).toBeGreaterThan(defaultBey.stamina.resource.fraction);
  });
});
