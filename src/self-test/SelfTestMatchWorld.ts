// ============================================================
// SELF-TEST MATCH WORLD (M8)
// One headless match built from the game's own production pieces: the
// Rapier world, the arena colliders, two Beys, the round rules, the Clash
// orchestration, advanced by the same tickMatch() main.ts uses (GDD section
// 114: a self-test must run the real rules, never a simplified combat).
// No renderer: the arena's visual group goes into a detached scene that is
// never drawn. Shared by the self-test/batch runner and, through
// CombatHarness, by the deterministic test suite, so the match setup lives
// in exactly one place.
// ============================================================

import * as THREE from 'three';
import { matchSpawnsFor, type SpawnPositionM } from '../app/bootstrap/matchSpawns';
import { ClashOrchestration } from '../app/simulation/ClashOrchestration';
import { MatchStepper, type MatchStepControllers, type MatchStepOutput } from '../app/simulation/MatchStepper';
import { buildCanonicalMatchState } from '../replay/state/CanonicalMatchState';
import type { CanonicalRecord } from '../replay/state/CanonicalValue';
import { tickMatch, type MatchTickResult } from '../app/simulation/tickMatch';
import { createArenaColliders } from '../arena/colliders/createArenaColliders';
import type { BeyDefinition } from '../bey/archetype/BeyDefinition';
import { createBey, type Bey } from '../bey/core/Bey';
import type { ClashAiMashSource } from '../combat/clash/ClashMash';
import { RoundState } from '../combat/round-rules/RoundState';
import { arenaGeometryOf, beyMatchRulesOf, resolveMatchConfig, type MatchConfig } from '../config/match/MatchConfig';
import { motionParams } from '../bey/motion/MotionPresets';
import type { ControllerActions } from '../input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../physics/fixed-step/FixedTimestepLoop';
import { PhysicsWorld } from '../physics/world/PhysicsWorld';

export interface SelfTestMatchWorldOptions {
  /** Omit for the live game's spawns (matchSpawns.ts), so a batch plays the real opening. */
  readonly firstSpawn?: SpawnPositionM;
  readonly secondSpawn?: SpawnPositionM;
  readonly matchConfigOverrides?: Partial<MatchConfig>;
  /**
   * Omit for ClashOrchestration's own default. Pass NullAiMashSource (as
   * main.ts does) whenever a side is driven by a real AIController, whose
   * own Z/X/C presses already reach the Clash — see ClashMash.ts.
   */
  readonly aiMashSource?: ClashAiMashSource;
  /** Omit for createBey's default definition. */
  readonly firstDefinition?: BeyDefinition;
  readonly secondDefinition?: BeyDefinition;
}

export class SelfTestMatchWorld {
  protected constructor(
    readonly physics: PhysicsWorld,
    readonly first: Bey,
    readonly second: Bey,
    readonly roundState: RoundState,
    readonly clash: ClashOrchestration,
  ) {}

  static async build(options: SelfTestMatchWorldOptions = {}): Promise<SelfTestMatchWorld> {
    const parts = await SelfTestMatchWorld.buildParts(options);
    return new SelfTestMatchWorld(parts.physics, parts.first, parts.second, parts.roundState, parts.clash);
  }

  /** The pieces of a world, for subclasses (CombatHarness) that construct themselves. */
  protected static async buildParts(options: SelfTestMatchWorldOptions): Promise<{
    physics: PhysicsWorld;
    first: Bey;
    second: Bey;
    roundState: RoundState;
    clash: ClashOrchestration;
  }> {
    const physics = await PhysicsWorld.create();
    const config = resolveMatchConfig(options.matchConfigOverrides ?? {});
    const motion = motionParams(config.motion);
    createArenaColliders(new THREE.Scene(), physics, arenaGeometryOf(config), undefined, motion); // detached scene: colliders only, never rendered.
    const floor = config.arenaFloor;
    const spawns = matchSpawnsFor(floor);
    const first = createBey(physics, options.firstSpawn ?? spawns.first, options.firstDefinition, floor, motion, beyMatchRulesOf(config));
    const second = createBey(physics, options.secondSpawn ?? spawns.second, options.secondDefinition, floor, motion, beyMatchRulesOf(config));
    const clash = options.aiMashSource !== undefined ? new ClashOrchestration(config, options.aiMashSource) : new ClashOrchestration(config);
    return { physics, first, second, roundState: new RoundState({ ringOutDelayS: config.ringOutDelayS }), clash };
  }

  /** Hitstop + controller sampling + tickMatch: the same per-tick step the live MatchSession runs (M9: one simulation). */
  readonly stepper = new MatchStepper();

  /**
   * Advances the match by exactly one fixed tick exactly as a live match
   * does, hitstop included (GDD 164: acceleration runs more ticks, never a
   * bigger delta). On a frozen tick `advanced` is false and the result is
   * the previous tick's.
   */
  step(controllers: MatchStepControllers): MatchStepOutput {
    return this.stepper.step(this, controllers, FIXED_DELTA_SECONDS);
  }

  /** CanonicalMatchStateV1 after `ticksCompleted` ticks (M9: the official state-hash input). */
  getCanonicalState(ticksCompleted: number): CanonicalRecord {
    return buildCanonicalMatchState({ ticksCompleted, world: this, hitstop: this.stepper.hitstop });
  }

  /** Low-level: one tickMatch() with the given actions, no controllers and no hitstop (physics/combat unit tests). */
  tick(firstActions: ControllerActions, secondActions: ControllerActions): MatchTickResult {
    return tickMatch(this.physics, this.first, this.second, firstActions, secondActions, FIXED_DELTA_SECONDS, this.roundState, this.clash);
  }

  /** Frees the Rapier world. Batches create many worlds; the WASM heap is not garbage-collected. */
  dispose(): void {
    this.physics.rapierWorld.free();
  }
}
