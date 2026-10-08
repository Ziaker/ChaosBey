// ============================================================
// AI RAIL PILOT — how the AI uses the rails (Rail Grinding, 0.53.0)
// Owner, 2026-10-08 ("a AI deve usar rails"): a small plan the AI runs outside its intent system, because a rail run is a
// short, scripted manoeuvre with its own rules (on a rail only attack-charging and a jump exist, and the Bey cannot be hit):
//   Approach  — run at the nearest rail point, with a clear gap to the opponent;
//   Jumping   — one jump press, early enough that the hop's flight reaches the rail;
//   Riding    — hold Attack (charge the Dash) and jump off when the route points at the opponent (or the rail is nearly over);
//   Released  — in the air / just landed: turn toward the opponent and let the Dash go when lined up.
// It reads only what a player sees (positions, speed, the rails' shape, its own state) and rolls its dice on the AI's seeded RNG.
// Every number is PROVISIONAL AI tuning.
// ============================================================

import { AttackState } from '../../combat/attacks/AttackController';
import { DriftState } from '../../drift/DriftController';
import type { RailController } from '../../arena/rails/RailController';
import { fromYaw, length, normalize, signedAngleBetween, subtract, type Vec2 } from '../../physics/Vec2';

export const RAIL_CONSIDER_INTERVAL_S = 1.5;
/** A rail further than this (m) from the AI is not worth a run. */
export const RAIL_MAX_APPROACH_M = 16;
/** Rails are for crossing open ground: closer to the opponent than this (m), the AI fights instead. */
export const RAIL_MIN_OPPONENT_DISTANCE_M = 7;
export const RAIL_APPROACH_TIMEOUT_S = 4;
export const RAIL_JUMP_MIN_SPEED_MPS = 5;
/** The hop reaches the rail about this long after the press, so the press comes (speed × this) metres before it. */
export const RAIL_JUMP_LEAD_S = 0.55;
export const RAIL_JUMP_MAX_HEADING_ERROR_RAD = 0.3;
export const RAIL_JUMPING_TIMEOUT_S = 1.6;
export const RAIL_COOLDOWN_S = 6;
export const RAIL_EXIT_ALIGN_RAD = 0.4;
export const RAIL_MIN_RIDE_S = 0.35;
export const RAIL_EXIT_REMAINING_M = 4;
export const RAIL_RELEASE_HEADING_ERROR_RAD = 0.5;
export const RAIL_RELEASED_TIMEOUT_S = 1.2;
/** Chance of starting a run at each consideration: this plus (aggression × the gain). */
export const RAIL_BASE_CHANCE = 0.3;
export const RAIL_AGGRESSION_CHANCE_GAIN = 0.4;
/** Chance of charging a Dash on a rail: this plus the personality's willingness for collisions (1 - collisionAvoidance) × the gain. */
export const RAIL_DASH_BASE_CHANCE = 0.2;
export const RAIL_DASH_COLLISION_GAIN = 0.8;

export enum RailPilotStage {
  Idle = 'Idle',
  Approach = 'Approach',
  Jumping = 'Jumping',
  Riding = 'Riding',
  Released = 'Released',
}

export interface RailPilotInput {
  readonly dt: number;
  readonly rail: RailController;
  readonly positionXZ: Vec2;
  readonly velocityXZ: Vec2;
  readonly headingRad: number;
  readonly grounded: boolean;
  readonly attackState: AttackState;
  readonly driftState: DriftState;
  readonly dashChargeFraction: number;
  /** Launched, stunned, locked: no rail business. */
  readonly impaired: boolean;
  readonly distanceToOpponentM: number;
  readonly directionToOpponent: Vec2;
  readonly opponentAttackState: AttackState;
  readonly aggression: number;
  /** 0..1: the personality's reluctance to start heavy collisions — it charges a Dash on the rail less often. */
  readonly collisionAvoidance: number;
  /** One roll of the AI's seeded RNG: true with the given probability. */
  readonly roll: (probability: number) => boolean;
}

export interface RailPilotOutput {
  /** Where to steer and drive (null = no movement keys). */
  readonly moveDirection: Vec2 | null;
  readonly holdAttack: boolean;
  /** Press Jump this tick. */
  readonly jump: boolean;
}

function nearestHorizontal(rail: RailController, from: Vec2): { point: Vec2; distanceM: number } | null {
  let best: { point: Vec2; distanceM: number } | null = null;
  for (const definition of rail.getRails()) {
    if (!definition.enabled) continue;
    for (const p of definition.path.points) {
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (best === null || d < best.distanceM) best = { point: { x: p.x, z: p.z }, distanceM: d };
    }
  }
  return best;
}

const headingError = (headingRad: number, direction: Vec2): number => Math.abs(signedAngleBetween(fromYaw(headingRad), direction));

export class RailPilot {
  private stage = RailPilotStage.Idle;
  private cooldownS = 0;
  private considerTimerS = 0;
  private stageTimeS = 0;
  private target: Vec2 = { x: 0, z: 0 };
  /** Decided when the ride starts: charge a Dash on the rail and let it go after leaving (else the rail is only a fast way across). */
  private dashOnExit = true;

  getStage(): RailPilotStage {
    return this.stage;
  }

  /** True while the pilot has the controls (the AI skips its intent pipeline). */
  isActive(): boolean {
    return this.stage !== RailPilotStage.Idle;
  }

  private enter(stage: RailPilotStage): void {
    this.stage = stage;
    this.stageTimeS = 0;
  }

  private finish(): void {
    this.enter(RailPilotStage.Idle);
    this.cooldownS = RAIL_COOLDOWN_S;
    this.considerTimerS = 0;
  }

  /** This tick's rail plan, or null when the AI plays its normal game. */
  step(i: RailPilotInput): RailPilotOutput | null {
    if (i.rail.getRails().length === 0) return null;
    this.cooldownS = Math.max(0, this.cooldownS - i.dt);
    this.stageTimeS += i.dt;
    const onRail = i.rail.isOnRail();
    const speed = length(i.velocityXZ);

    // Something took the AI off the plan (a launch, a lock, a Clash): back to normal play.
    if (this.stage !== RailPilotStage.Idle && this.stage !== RailPilotStage.Riding && i.impaired) {
      this.finish();
      return null;
    }

    switch (this.stage) {
      case RailPilotStage.Idle: {
        if (onRail) {
          // Grabbed a rail without having planned it (an ordinary jump): ride it like a planned run.
          this.startRide(i);
          return this.riding(i);
        }
        this.considerTimerS += i.dt;
        if (this.cooldownS > 0 || this.considerTimerS < RAIL_CONSIDER_INTERVAL_S) return null;
        this.considerTimerS = 0;
        const ready =
          i.grounded && !i.impaired && i.attackState === AttackState.Neutral && i.driftState === DriftState.Idle &&
          i.distanceToOpponentM >= RAIL_MIN_OPPONENT_DISTANCE_M;
        if (!ready) return null;
        const nearest = nearestHorizontal(i.rail, i.positionXZ);
        if (nearest === null || nearest.distanceM > RAIL_MAX_APPROACH_M) return null;
        if (!i.roll(RAIL_BASE_CHANCE + RAIL_AGGRESSION_CHANCE_GAIN * Math.max(0, Math.min(1, i.aggression)))) return null;
        this.target = nearest.point;
        this.enter(RailPilotStage.Approach);
        return this.approach(i, speed);
      }
      case RailPilotStage.Approach:
        return this.approach(i, speed);
      case RailPilotStage.Jumping: {
        if (onRail) {
          this.startRide(i);
          return this.riding(i);
        }
        if (this.stageTimeS >= RAIL_JUMPING_TIMEOUT_S || (i.grounded && this.stageTimeS > 0.2)) {
          this.finish(); // the hop came down short of the rail
          return null;
        }
        return { moveDirection: normalize(subtract(this.target, i.positionXZ)), holdAttack: false, jump: false };
      }
      case RailPilotStage.Riding:
        return this.riding(i);
      case RailPilotStage.Released: {
        if (!this.dashOnExit) {
          this.finish();
          return null;
        }
        const toward = i.directionToOpponent;
        const lined = length(toward) > 0 && headingError(i.headingRad, toward) <= RAIL_RELEASE_HEADING_ERROR_RAD;
        if (lined || i.dashChargeFraction >= 1 || this.stageTimeS >= RAIL_RELEASED_TIMEOUT_S || i.attackState === AttackState.Neutral) {
          this.finish(); // letting go of Attack is what fires the Dash
          return { moveDirection: null, holdAttack: false, jump: false };
        }
        return { moveDirection: toward, holdAttack: true, jump: false };
      }
    }
  }

  private startRide(i: RailPilotInput): void {
    this.dashOnExit = i.roll(RAIL_DASH_BASE_CHANCE + RAIL_DASH_COLLISION_GAIN * (1 - Math.max(0, Math.min(1, i.collisionAvoidance))));
    this.enter(RailPilotStage.Riding);
  }

  private approach(i: RailPilotInput, speed: number): RailPilotOutput | null {
    const toTarget = subtract(this.target, i.positionXZ);
    const distance = length(toTarget);
    const opponentDashing = i.opponentAttackState === AttackState.DashActive && i.distanceToOpponentM < 12;
    if (this.stageTimeS >= RAIL_APPROACH_TIMEOUT_S || !i.grounded || i.impaired || opponentDashing || i.distanceToOpponentM < RAIL_MIN_OPPONENT_DISTANCE_M / 2) {
      this.finish();
      return null;
    }
    const direction = normalize(toTarget);
    const leadM = Math.max(3, Math.min(9, speed * RAIL_JUMP_LEAD_S));
    if (distance <= leadM && speed >= RAIL_JUMP_MIN_SPEED_MPS && headingError(i.headingRad, direction) <= RAIL_JUMP_MAX_HEADING_ERROR_RAD && i.attackState === AttackState.Neutral) {
      this.enter(RailPilotStage.Jumping);
      return { moveDirection: direction, holdAttack: false, jump: true };
    }
    return { moveDirection: direction, holdAttack: false, jump: false };
  }

  private riding(i: RailPilotInput): RailPilotOutput | null {
    if (!i.rail.isOnRail()) {
      // The ride is over (the end of the rail, or something interrupted it).
      this.enter(RailPilotStage.Released);
      return { moveDirection: i.directionToOpponent, holdAttack: this.dashOnExit, jump: false };
    }
    const route = i.rail.getRoute();
    let jump = false;
    if (route !== null && this.stageTimeS >= RAIL_MIN_RIDE_S) {
      const tangent = normalize({ x: route.tangent.x, z: route.tangent.z });
      const aligned = length(i.directionToOpponent) > 0 && Math.abs(signedAngleBetween(tangent, i.directionToOpponent)) <= RAIL_EXIT_ALIGN_RAD;
      jump = aligned || route.remainingM < RAIL_EXIT_REMAINING_M;
    }
    if (jump) this.enter(RailPilotStage.Released);
    return { moveDirection: null, holdAttack: this.dashOnExit, jump };
  }
}
