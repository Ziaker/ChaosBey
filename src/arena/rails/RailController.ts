// ============================================================
// RAIL CONTROLLER — one Bey's rail grinding (Rail Grinding, 0.52.0)
// Owner, 2026-10-08, on docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md §13:
//   1. a Bey GRABS a rail by JUMPING TOWARD it (airborne in its own hop, within reach, moving toward the rail);
//   2. the way there and the way back are THE SAME ROUTE (a rail is a line, not a one-way lane): the Bey travels it in the
//      direction it was going when it grabbed it, and leaves at the end it reaches;
//   3. on a rail the Bey can only CHARGE its attack and JUMP — a jump leaves the rail early, back to the arena;
//   4. two rails per stage to start (StageRails.ts).
// Everything else (collisions, AI use, speed numbers, visuals) is provisional — RAIL_TUNING in RailTraversal.ts.
//
// This is a state machine, not a body writer: it reads the Bey's position/velocity, decides, and hands back (a) the actions
// the Bey may still use this tick, (b) a velocity OVERRIDE for MovementController — which stays the only writer of the
// Bey's velocity while on the rail, like Dash and Dodge — and (c) a launch for the tick the Bey leaves. The route is the
// authority while the Bey is on it, but the Bey's way onto it is a short, limited correction (attachCorrectionPerS), never
// a snap, and its speed on leaving is the speed it had (exitSpeedCarry).
// ============================================================

import { Action, type ControllerActions } from '../../input/actions/Action';
import type { RailDefinition } from './RailBlueprint';
import type { Point3 } from './RailPath';
import { NOT_ON_RAIL, RAIL_TUNING, type RailDirection, type RailExitReason, type RailTraversalState, type RailTuning } from './RailTraversal';

export interface RailOverride {
  /** The velocity the Bey is driven with this tick (m/s, 3D): along the route, plus the correction toward it. */
  readonly velocity: Point3;
  /** The yaw the Bey faces (rad): along its way of travel. */
  readonly headingRad: number;
}

export interface RailTickInput {
  readonly actions: ControllerActions;
  readonly position: Point3;
  readonly velocity: Point3;
  readonly headingRad: number;
  readonly grounded: boolean;
  /** The Bey is in its own hop / jump flight (DriftController Hopping): the only way onto a rail. */
  readonly inOwnHop: boolean;
  /** Something forbids grabbing a rail now (an attack out or recovering, a Clash stun, a knockback playing). */
  readonly attachBlocked: boolean;
  readonly dt: number;
}

export interface RailTickOutput {
  /** The actions the Bey may use this tick: on a rail, Dodge and Jump are taken out (a Jump press is what leaves the rail). */
  readonly actions: ControllerActions;
  readonly override: RailOverride | null;
  /** Velocity to give the body at once (the tick the Bey leaves the rail), else null. */
  readonly launch: Point3 | null;
  readonly entered: boolean;
  readonly exitReason: RailExitReason | null;
}

export interface RailControllerOptions {
  readonly tuning?: RailTuning;
  /** Upward speed a Jump press gives on leaving the rail (m/s): the Bey's own short hop. */
  readonly jumpExitLiftMps?: number;
}

const horizontal = (v: Point3): number => Math.hypot(v.x, v.z);

function withoutActions(actions: ControllerActions, removed: readonly Action[]): ControllerActions {
  if (!removed.some((a) => actions.held.has(a) || actions.pressedThisFrame.has(a))) return actions;
  return {
    ...actions,
    held: new Set([...actions.held].filter((a) => !removed.includes(a))),
    pressedThisFrame: new Set([...actions.pressedThisFrame].filter((a) => !removed.includes(a))),
  };
}

/** The longest a Bey stays untouchable after leaving a rail while still overlapping the other Bey (s). */
export const RAIL_INTANGIBLE_AFTER_MAX_S = 1;

export class RailController {
  private readonly tuning: RailTuning;
  private readonly jumpExitLiftMps: number;
  private state: RailTraversalState = NOT_ON_RAIL;
  private railIndex = -1;
  private cooldownS = 0;
  /** Owner, 2026-10-08 ("não tem como levar um golpe no trilho, ele fica fora da arena"): on a rail the Bey cannot be touched. */
  private intangible = false;
  private intangibleAfterS = 0;

  constructor(
    private readonly rails: readonly RailDefinition[],
    options: RailControllerOptions = {},
  ) {
    this.tuning = options.tuning ?? RAIL_TUNING;
    this.jumpExitLiftMps = options.jumpExitLiftMps ?? 0;
  }

  /** The rails this Bey can grab (the AI reads them to plan a run; the controller never changes them). */
  getRails(): readonly RailDefinition[] {
    return this.rails;
  }

  /** Where the route goes from the Bey's progress, in the direction it travels: the AI reads it to pick the moment to leave. Null off a rail. */
  getRoute(): { readonly tangent: Point3; readonly remainingM: number } | null {
    if (!this.isOnRail() || this.railIndex < 0) return null;
    const rail = this.rails[this.railIndex]!;
    const sample = rail.path.sampleAt(this.state.progressM);
    const remainingM = this.state.direction > 0 ? rail.path.lengthM - this.state.progressM : this.state.progressM;
    return { tangent: { x: sample.tangent.x * this.state.direction, y: sample.tangent.y * this.state.direction, z: sample.tangent.z * this.state.direction }, remainingM };
  }

  /**
   * Out of the arena while on a rail: no solver contact, no hit, no body collision (the same pass-through a Dodge gives, see
   * DodgeController.updateIntangibility). After leaving it lasts until the two bodies no longer overlap, so a Bey that jumps
   * off right above the other is not popped apart (capped at RAIL_INTANGIBLE_AFTER_MAX_S).
   */
  updateIntangibility(overlappingOpponent: boolean, dt: number): void {
    if (this.isOnRail()) {
      this.intangible = true;
      this.intangibleAfterS = 0;
      return;
    }
    if (!this.intangible) return;
    this.intangibleAfterS += dt;
    if (!overlappingOpponent || this.intangibleAfterS >= RAIL_INTANGIBLE_AFTER_MAX_S) {
      this.intangible = false;
      this.intangibleAfterS = 0;
    }
  }

  isIntangible(): boolean {
    return this.intangible;
  }

  getState(): RailTraversalState {
    return this.state;
  }

  isOnRail(): boolean {
    return this.state.railId !== null;
  }

  /** Something took the Bey off the rail without its own decision (a hit, a Clash): it keeps whatever velocity the world gave it. */
  interrupt(reason: RailExitReason = 'interrupted'): void {
    if (!this.isOnRail()) return;
    this.leave(reason);
  }

  private leave(reason: RailExitReason): void {
    this.state = { ...NOT_ON_RAIL, exitReason: reason };
    this.railIndex = -1;
    this.cooldownS = this.tuning.reattachCooldownS;
  }

  tick(input: RailTickInput): RailTickOutput {
    this.cooldownS = Math.max(0, this.cooldownS - input.dt);
    if (this.rails.length === 0) return { actions: input.actions, override: null, launch: null, entered: false, exitReason: null };

    let entered = false;
    if (!this.isOnRail()) {
      entered = this.tryGrab(input);
      if (!entered) return { actions: input.actions, override: null, launch: null, entered: false, exitReason: null };
    }

    const rail = this.rails[this.railIndex]!;
    const actions = withoutActions(input.actions, [Action.Dodge, Action.JumpDrift]);

    // A Jump press leaves the rail early, back to the arena: the speed it had, along the route, and a short hop's lift.
    if (!entered && input.actions.pressedThisFrame.has(Action.JumpDrift)) {
      const sample = rail.path.sampleAt(this.state.progressM);
      const launch = this.exitVelocity(sample.tangent, this.state.direction, this.state.speedMps, this.jumpExitLiftMps);
      this.leave('voluntary');
      return { actions, override: null, launch, entered: false, exitReason: 'voluntary' };
    }

    // Advance along the route: toward the target speed, in the direction it was grabbed.
    let speed = this.state.speedMps;
    if (!entered) {
      if (speed < this.tuning.targetSpeedMps) speed = Math.min(this.tuning.targetSpeedMps, speed + this.tuning.accelerationMps2 * input.dt);
      else speed = Math.max(this.tuning.targetSpeedMps, speed - this.tuning.accelerationMps2 * input.dt);
    }
    speed = Math.min(this.tuning.maxSpeedMps, speed);
    const direction = this.state.direction;
    const progress = this.state.progressM + (entered ? 0 : direction * speed * input.dt);
    const length = rail.path.lengthM;
    if (!rail.path.closed && (progress >= length || progress <= 0)) {
      const end = rail.path.sampleAt(progress >= length ? length : 0);
      const launch = this.exitVelocity(end.tangent, direction, speed, this.tuning.exitLiftMps);
      this.leave('end');
      return { actions, override: null, launch, entered: false, exitReason: 'end' };
    }

    const sample = rail.path.sampleAt(progress);
    const along = { x: sample.tangent.x * direction * speed, y: sample.tangent.y * direction * speed, z: sample.tangent.z * direction * speed };
    // Onto the line, not a snap: a pull toward the point of the route, limited.
    const error = { x: sample.position.x - input.position.x, y: sample.position.y - input.position.y, z: sample.position.z - input.position.z };
    const errorLength = Math.hypot(error.x, error.y, error.z);
    const pull = errorLength > 1e-9 ? Math.min(this.tuning.attachCorrectionMaxMps, errorLength * this.tuning.attachCorrectionPerS) / errorLength : 0;
    const velocity = { x: along.x + error.x * pull, y: along.y + error.y * pull, z: along.z + error.z * pull };
    this.state = {
      ...this.state,
      progressM: sample.progressM,
      speedMps: speed,
      timeOnRailS: this.state.timeOnRailS + (entered ? 0 : input.dt),
    };
    return {
      actions,
      override: { velocity, headingRad: Math.atan2(sample.tangent.x * direction, sample.tangent.z * direction) },
      launch: null,
      entered,
      exitReason: null,
    };
  }

  /** The velocity a Bey leaves with: the route's tangent at the speed it had (× the carry), plus a lift. */
  private exitVelocity(tangent: Point3, direction: RailDirection, speed: number, liftMps: number): Point3 {
    const carried = speed * this.tuning.exitSpeedCarry;
    return { x: tangent.x * direction * carried, y: tangent.y * direction * carried + liftMps, z: tangent.z * direction * carried };
  }

  /** Grabs the nearest rail within reach if the Bey is jumping toward it. */
  private tryGrab(input: RailTickInput): boolean {
    if (this.cooldownS > 0 || input.attachBlocked || input.grounded || !input.inOwnHop) return false;
    let best = -1;
    let bestDistance = Infinity;
    let bestProjection: ReturnType<RailDefinition['path']['project']> | null = null;
    for (let i = 0; i < this.rails.length; i++) {
      const rail = this.rails[i]!;
      if (!rail.enabled) continue;
      const projection = rail.path.project(input.position);
      if (projection.distanceM > this.tuning.captureRadiusM || projection.distanceM >= bestDistance) continue;
      if (!this.movingToward(input, projection.position)) continue;
      best = i;
      bestDistance = projection.distanceM;
      bestProjection = projection;
    }
    if (best < 0 || bestProjection === null) return false;
    const rail = this.rails[best]!;
    const sample = rail.path.sampleAt(bestProjection.progressM);
    const hs = horizontal(input.velocity);
    // Direction: the way the Bey was going along the route; a Bey (almost) at rest takes the way it faces.
    let along = input.velocity.x * sample.tangent.x + input.velocity.z * sample.tangent.z;
    if (Math.abs(along) < 1) along = Math.sin(input.headingRad) * sample.tangent.x + Math.cos(input.headingRad) * sample.tangent.z;
    const direction: RailDirection = along < 0 ? -1 : 1;
    this.railIndex = best;
    this.state = {
      railId: rail.id,
      progressM: bestProjection.progressM,
      direction,
      speedMps: Math.max(this.tuning.startSpeedMps, hs * this.tuning.entrySpeedCarry),
      entrySpeedMps: hs,
      timeOnRailS: 0,
      entryReason: 'jump',
      exitReason: null,
    };
    return true;
  }

  /** "Jumping toward it": within the entry angle of the way to the rail (a Bey nearly at rest, or right at it, counts). */
  private movingToward(input: RailTickInput, point: Point3): boolean {
    const hs = horizontal(input.velocity);
    const toX = point.x - input.position.x;
    const toZ = point.z - input.position.z;
    const toLength = Math.hypot(toX, toZ);
    if (hs < Math.max(1, this.tuning.minEntrySpeedMps) || toLength < 0.05) return hs >= this.tuning.minEntrySpeedMps;
    return (input.velocity.x * toX + input.velocity.z * toZ) / (hs * toLength) >= Math.cos(this.tuning.entryAngleTolRad);
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
  getDeterministicState(): Record<string, string | number | boolean | null> {
    return {
      railIndex: this.railIndex,
      railId: this.state.railId,
      progressM: this.state.progressM,
      direction: this.state.direction,
      speedMps: this.state.speedMps,
      entrySpeedMps: this.state.entrySpeedMps,
      timeOnRailS: this.state.timeOnRailS,
      entryReason: this.state.entryReason,
      exitReason: this.state.exitReason,
      cooldownS: this.cooldownS,
      intangible: this.intangible,
      intangibleAfterS: this.intangibleAfterS,
    };
  }
}
