// ============================================================
// MATCH STEPPER — ONE FIXED TICK OF THE REAL MATCH
// The single definition of "advance the match one tick", used by the live
// MatchSession (play + Debug Lab), the headless Self Test batches and the
// GDD 68 scenario runner, so all three run the same simulation (M9: one
// simulation, replays portable between live and headless).
//
// Per tick:
// 1. read hitstop: is this tick frozen?
// 2. sample both controllers (told whether the tick is frozen, so a press
//    during the freeze is buffered, not lost);
// 3. run tickMatch() unless frozen (a frozen tick reuses the last result);
// 4. feed this tick's impact magnitudes to the hitstop clock.
// Step 4 mirrors the camera branches MatchSession used before M9: a Clash
// resolution fires only its own resolution magnitude; a tick that ends with
// a Clash Active fires nothing; otherwise every hit / break / KO /
// ring-out / dodge event of the tick counts.
// ============================================================

import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import type { Bey } from '../../bey/core/Bey';
import type { CombatController, ControllerActions } from '../../input/actions/Action';
import type { RoundState } from '../../combat/round-rules/RoundState';
import { ClashState } from '../../combat/clash/ClashController';
import type { ClashResult } from '../../combat/clash/ClashController';
import { buildImpactEventsForTick } from './impact/ImpactEvents';
import { CLASH_RESOLVED_MAGNITUDE } from './impact/ImpactMagnitude';
import type { ClashOrchestration } from './ClashOrchestration';
import { HitstopClock } from './Hitstop';
import { tickMatch, type MatchTickResult } from './tickMatch';

export interface MatchStepWorld {
  readonly physics: PhysicsWorld;
  readonly first: Bey;
  readonly second: Bey;
  readonly roundState: RoundState;
  readonly clash: ClashOrchestration;
}

export interface MatchStepControllers {
  readonly first: CombatController;
  readonly second: CombatController;
}

export interface MatchStepOutput {
  readonly firstActions: ControllerActions;
  readonly secondActions: ControllerActions;
  /** On a frozen tick this is the previous tick's result, reused: don't count its events again. */
  readonly result: MatchTickResult;
  /** False when hitstop froze this tick (tickMatch() did not run). */
  readonly advanced: boolean;
  /** Non-null only on the tick a Clash resolved (never on a frozen tick). */
  readonly clashResolvedThisTick: ClashResult | null;
}

const ORIGIN = { x: 0, y: 0, z: 0 };

export class MatchStepper {
  readonly hitstop = new HitstopClock();
  private lastResult: MatchTickResult | null = null;

  step(world: MatchStepWorld, controllers: MatchStepControllers, fixedDeltaSeconds: number): MatchStepOutput {
    const frozen = this.hitstop.isFreezing() && this.lastResult !== null;
    const firstActions = controllers.first.sampleActions({ fixedDeltaSeconds, simulationFrozen: frozen });
    const secondActions = controllers.second.sampleActions({ fixedDeltaSeconds, simulationFrozen: frozen });

    const result =
      frozen && this.lastResult
        ? this.lastResult
        : tickMatch(world.physics, world.first, world.second, firstActions, secondActions, fixedDeltaSeconds, world.roundState, world.clash);
    this.lastResult = result;

    const clashResolvedThisTick = frozen ? null : result.clashResolvedThisTick;
    const clashActive = world.clash.controller.getState() === ClashState.Active;
    this.hitstop.advance(impactMagnitudesForTick(result, frozen, clashResolvedThisTick, clashActive), clashActive, fixedDeltaSeconds);

    return { firstActions, secondActions, result, advanced: !frozen, clashResolvedThisTick };
  }
}

function impactMagnitudesForTick(result: MatchTickResult, frozen: boolean, clashResolvedThisTick: ClashResult | null, clashActive: boolean): number[] {
  if (frozen) return [];
  if (clashResolvedThisTick) return [CLASH_RESOLVED_MAGNITUDE];
  if (clashActive) return [];
  // Positions don't affect magnitudes; only the magnitudes decide hitstop.
  return buildImpactEventsForTick(result, ORIGIN, ORIGIN).map((event) => event.magnitude);
}
