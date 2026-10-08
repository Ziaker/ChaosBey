// ============================================================
// RAIL CONTROLLER — one Bey's rail grinding (Rail Grinding, 0.52.0)
// Owner, 2026-10-08, on docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md §13:
//   1. a Bey GRABS a rail by JUMPING TOWARD it (airborne in its own hop, within reach, moving toward the rail);
//   2. the way there and the way back are THE SAME ROUTE (a rail is a line, not a one-way lane): the Bey travels it in the
//      direction it was going when it grabbed it, and leaves at the end it reaches;
//   3. on a rail the Bey can only CHARGE its attack and JUMP — a jump leaves the rail early, back to the arena;
//   4. two rails per stage to start (StageRails.ts).
//   5. (0.56.0, owner chose course A) a rail is a long COURSE with a gate inside the wall at each end: it is entered only
//      through a gate (never from the middle), carries the Bey out over the wall, round the outside and back in; a Jump press
//      INSIDE the wall leaves it, but OUTSIDE the arena it turns the Bey round to come back along the same route to the gate it
//      entered by ("o caminho de ida e de volta são os mesmos"); and a Bey on a rail is out of the arena (untouchable).
// Everything else (AI use, speed numbers, visuals) is provisional — RAIL_TUNING in RailTraversal.ts, the Pregame's Rail speed.
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
  /** The Bey pressed Jump outside the arena and is coming back along the route to the gate it entered by. */
  private returning = false;

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
  getRoute(): { readonly tangent: Point3; readonly remainingM: number; readonly insideArena: boolean; readonly returning: boolean } | null {
    if (!this.isOnRail() || this.railIndex < 0) return null;
    const rail = this.rails[this.railIndex]!;
    const sample = rail.path.sampleAt(this.state.progressM);
    const remainingM = this.state.direction > 0 ? rail.path.lengthM - this.state.progressM : this.state.progressM;
    return {
      tangent: { x: sample.tangent.x * this.state.direction, y: sample.tangent.y * this.state.direction, z: sample.tangent.z * this.state.direction },
      remainingM,
      insideArena: horizontal(sample.position) < rail.arenaRadiusM,
      returning: this.returning,
    };
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
    this.returning = false;
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

    // A Jump press leaves the rail early. INSIDE the wall that is back into the arena: the speed it had, along the route, and a
    // short hop's lift. OUTSIDE the arena there is nowhere to land, so the Bey turns round and comes back along the same route
    // to the gate it entered by (and leaves there), once.
    if (!entered && !this.returning && input.actions.pressedThisFrame.has(Action.JumpDrift)) {
      const sample = rail.path.sampleAt(this.state.progressM);
      if (horizontal(sample.position) < rail.arenaRadiusM) {
        const launch = this.exitVelocity(sample.tangent, this.state.direction, this.state.speedMps, this.jumpExitLiftMps);
        this.leave('voluntary');
        return { actions, override: null, launch, entered: false, exitReason: 'voluntary' };
      }
      this.returning = true;
      this.state = { ...this.state, direction: this.state.direction === 1 ? -1 : 1 };
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
    // Only the end it is travelling toward: a Bey that grabs a gate sits AT that end (progress 0 or the full length) and sets off from it.
    if (!rail.path.closed && ((direction > 0 && progress >= length) || (direction < 0 && progress <= 0))) {
      const end = rail.path.sampleAt(direction > 0 ? length : 0);
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

  /** Grabs a rail by one of its gates if the Bey is jumping toward it: within reach of the route, and within the gate zone of an end. */
  private tryGrab(input: RailTickInput): boolean {
    if (this.cooldownS > 0 || input.attachBlocked || input.grounded || !input.inOwnHop) return false;
    let best = -1;
    let bestDistance = Infinity;
    let bestProjection: ReturnType<RailDefinition['path']['project']> | null = null;
    let bestDirection: RailDirection = 1;
    for (let i = 0; i < this.rails.length; i++) {
      const rail = this.rails[i]!;
      if (!rail.enabled) continue;
      const projection = rail.path.project(input.position);
      if (projection.distanceM > this.tuning.captureRadiusM || projection.distanceM >= bestDistance) continue;
      // Gates only: the Bey enters at an end and travels away from it; the middle of the course (outside the arena) is no entrance.
      const fromStart = projection.progressM;
      const fromEnd = rail.path.lengthM - projection.progressM;
      if (Math.min(fromStart, fromEnd) > this.tuning.gateZoneM) continue;
      if (!this.movingToward(input, projection.position)) continue;
      best = i;
      bestDistance = projection.distanceM;
      bestProjection = projection;
      bestDirection = fromStart <= fromEnd ? 1 : -1;
    }
    if (best < 0 || bestProjection === null) return false;
    const rail = this.rails[best]!;
    const hs = horizontal(input.velocity);
    this.railIndex = best;
    this.returning = false;
    this.state = {
      railId: rail.id,
      progressM: bestProjection.progressM,
      direction: bestDirection,
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
      returning: this.returning,
      intangible: this.intangible,
      intangibleAfterS: this.intangibleAfterS,
    };
  }
}
