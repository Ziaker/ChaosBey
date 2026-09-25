// ============================================================
// DETERMINISTIC PHYSICS TEST HARNESS
// Drives the same tick order main.ts uses (drift -> movement pre-step ->
// physics.step() -> movement post-step -> spin impact), headless, so
// Milestone 1's physics self-tests (GDD section 150) exercise the real
// controllers rather than a simplified stand-in (GDD section 114: a
// self-test must be able to catch real gameplay bugs).
// ============================================================

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { createArenaColliders } from '../../src/arena/colliders/createArenaColliders';
import { createBeyRigidBody } from '../../src/bey/core/BeyRigidBody';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { MovementController, type MovementSnapshot } from '../../src/bey/movement/MovementController';
import { SpinController, type SpinSnapshot } from '../../src/bey/spin/SpinController';
import { FULL_PHYSICAL_CONDITION } from '../../src/bey/stamina/StaminaSystem';
import { DriftController, type DriftState } from '../../src/drift/DriftController';
import type { ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';

export interface TickResult {
  movement: MovementSnapshot;
  spin: SpinSnapshot;
  grounded: boolean;
  driftState: DriftState;
}

export class TestBeyHarness {
  private constructor(
    readonly physics: PhysicsWorld,
    readonly beyBody: RAPIER.RigidBody,
    readonly beyCollider: RAPIER.Collider,
    readonly movement: MovementController,
    readonly spin: SpinController,
    readonly drift: DriftController,
  ) {}

  static async create(spawn: { x: number; y: number; z: number } = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 }): Promise<TestBeyHarness> {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene(); // no renderer involved — safe in a headless test environment.
    createArenaColliders(scene, physics);
    const { body, collider } = createBeyRigidBody(physics, spawn);
    return new TestBeyHarness(physics, body, collider, new MovementController(), new SpinController(), new DriftController());
  }

  tick(actions: ControllerActions): TickResult {
    const grounded = isGrounded(this.physics, this.beyCollider);

    const driftResult = this.drift.tick(this.beyBody, actions, grounded, FIXED_DELTA_SECONDS);
    this.movement.applyPreStep(this.beyBody, {
      actions,
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
      grounded,
      lateralGripOverridePerS: driftResult.lateralGripOverridePerS,
      staminaAccelFactor: FULL_PHYSICAL_CONDITION.accelFactor,
      dashOverride: null,
    });
    this.spin.tick(this.beyBody, FIXED_DELTA_SECONDS, FULL_PHYSICAL_CONDITION);

    this.physics.step();

    const movementSnapshot = this.movement.postStep(this.beyBody, grounded);
    if (movementSnapshot.impactDeltaSpeedMps > 0) {
      this.spin.registerImpact(this.beyBody, movementSnapshot.impactDeltaSpeedMps, movementSnapshot.impactDirection);
    }

    return {
      movement: movementSnapshot,
      spin: this.spin.getSnapshot(this.beyBody),
      grounded,
      driftState: driftResult.driftState,
    };
  }

  tickMany(actions: ControllerActions, count: number): TickResult[] {
    const results: TickResult[] = [];
    for (let i = 0; i < count; i++) {
      results.push(this.tick(actions));
    }
    return results;
  }
}

export function isFiniteVec3(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
