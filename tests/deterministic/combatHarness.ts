// ============================================================
// DETERMINISTIC COMBAT TEST HARNESS
// Two Beys driven through the exact same tickMatch() orchestration
// main.ts uses, headless — Milestone 2's combat self-tests (GDD section
// 151) exercise the real controllers, not a simplified stand-in (GDD
// section 114).
// ============================================================

import * as THREE from 'three';
import { createArenaColliders } from '../../src/arena/colliders/createArenaColliders';
import { createBey, type Bey } from '../../src/bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { tickMatch, type MatchTickResult } from '../../src/app/simulation/tickMatch';
import { ClashOrchestration } from '../../src/app/simulation/ClashOrchestration';
import { RoundState } from '../../src/combat/round-rules/RoundState';
import type { ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';

export class CombatHarness {
  private constructor(
    readonly physics: PhysicsWorld,
    readonly first: Bey,
    readonly second: Bey,
    readonly roundState: RoundState,
    readonly clash: ClashOrchestration,
  ) {}

  static async create(
    firstSpawn: { x: number; y: number; z: number } = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -2 },
    secondSpawn: { x: number; y: number; z: number } = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 2 },
  ): Promise<CombatHarness> {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene(); // no renderer involved — safe headless.
    createArenaColliders(scene, physics);
    const first = createBey(physics, firstSpawn);
    const second = createBey(physics, secondSpawn);
    return new CombatHarness(physics, first, second, new RoundState(), new ClashOrchestration());
  }

  tick(firstActions: ControllerActions, secondActions: ControllerActions): MatchTickResult {
    return tickMatch(this.physics, this.first, this.second, firstActions, secondActions, FIXED_DELTA_SECONDS, this.roundState, this.clash);
  }
}
