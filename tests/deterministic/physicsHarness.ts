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
import type { ArenaGeometry } from '../../src/arena/presets/ArenaPresets';
import { createArenaColliders } from '../../src/arena/colliders/createArenaColliders';
import { createBeyRigidBody } from '../../src/bey/core/BeyRigidBody';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { MovementController, type MovementSnapshot } from '../../src/bey/movement/MovementController';
import { SpinController, type SpinSnapshot } from '../../src/bey/spin/SpinController';
import { motionParams, type MotionParams } from '../../src/bey/motion/MotionPresets';
import { FULL_PHYSICAL_CONDITION } from '../../src/bey/stamina/StaminaSystem';
import { DriftController, type DriftState } from '../../src/drift/DriftController';
import { DodgeController, type DodgeState } from '../../src/dodge/DodgeController';
import type { ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';

export interface TickResult {
  movement: MovementSnapshot;
  spin: SpinSnapshot;
  grounded: boolean;
  driftState: DriftState;
  dodgeState: DodgeState;
}

export class TestBeyHarness {
  private constructor(
    readonly physics: PhysicsWorld,
    readonly beyBody: RAPIER.RigidBody,
    readonly beyCollider: RAPIER.Collider,
    readonly movement: MovementController,
    readonly spin: SpinController,
    readonly drift: DriftController,
    readonly dodge: DodgeController,
  ) {}

  /** A stand-in Stamina value high enough that DodgeController's cost check never blocks a test from dodging. */
  stamina = 100_000;

  /** `motion`: the motion direction (M11 Motion Lab A/B/C); B, the game's default, when omitted. */
  static async create(spawn: { x: number; y: number; z: number } = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 }, motion: MotionParams = motionParams(), geometry?: ArenaGeometry): Promise<TestBeyHarness> {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene(); // no renderer involved — safe in a headless test environment.
    createArenaColliders(scene, physics, geometry, undefined, motion);
    const { body, collider } = createBeyRigidBody(physics, spawn, undefined, motion);
    const movement = new MovementController(undefined, motion);
    return new TestBeyHarness(physics, body, collider, movement, new SpinController(motion), new DriftController(movement.getLateralGripPerS()), new DodgeController());
  }

  /**
   * `midStepEffect`, when given, runs after applyPreStep and before
   * physics.step() — the same window a real combat impact's knockback
   * impulse lands in (see Knockback.ts), so a test can apply one and have
   * MovementController.postStep() correctly detect it as an impact
   * (comparing the resulting velocity against what applyPreStep itself
   * intended), instead of the impulse being silently overwritten before
   * physics.step() ever runs.
   */
  tick(actions: ControllerActions, midStepEffect?: (body: RAPIER.RigidBody) => void): TickResult {
    const grounded = isGrounded(this.physics, this.beyCollider);

    const driftResult = this.drift.tick(this.beyBody, actions, grounded, FIXED_DELTA_SECONDS, this.movement.getHeadingRad());
    const dodgeResult = this.dodge.tick(this.beyBody, actions, this.movement.getHeadingRad(), grounded, this.stamina, FIXED_DELTA_SECONDS);
    this.stamina -= dodgeResult.staminaCostThisTick;
    this.movement.applyPreStep(this.beyBody, {
      actions,
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
      grounded,
      lateralGripOverridePerS: dodgeResult.lateralGripOverridePerS ?? driftResult.lateralGripOverridePerS,
      staminaAccelFactor: FULL_PHYSICAL_CONDITION.accelFactor,
      dashOverride: null,
      dodgeOverride: dodgeResult.dodgeOverride,
    });
    midStepEffect?.(this.beyBody);
    this.spin.tick(this.beyBody, FIXED_DELTA_SECONDS, FULL_PHYSICAL_CONDITION, grounded);

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
      dodgeState: dodgeResult.state,
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
