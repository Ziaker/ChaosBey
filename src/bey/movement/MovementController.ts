// ============================================================
// MOVEMENT CONTROLLER
// Force/response-based translational movement — never sets position
// directly, never snaps velocity to the input direction (GDD section 15).
// Owns heading (a gameplay value, independent of the rigid body's physics
// orientation) and drives the body's linear velocity from
// acceleration/steering/grip each tick.
//
// Tick order (see main.ts): applyPreStep() before physics.step(), postStep()
// after. Between a collision and POST_IMPACT_GRIP_SUPPRESSION_S later,
// applyPreStep backs off from overriding velocity so a wall/floor bounce
// is actually visible instead of being instantly overwritten by the grip
// model (GDD section 27/85).
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import { type ControllerActions, Action } from '../../input/actions/Action';
import { add, dot, fromYaw, length, scale, signedAngleBetween, type Vec2 } from '../../physics/Vec2';
import {
  ACCELERATION_MPS2,
  AIRBORNE_ACCELERATION_FACTOR,
  AIRBORNE_LATERAL_GRIP_PER_S,
  IMPACT_VELOCITY_DELTA_THRESHOLD_MPS,
  INTENDED_MAX_SPEED_MPS,
  LATERAL_GRIP_PER_S,
  LONGITUDINAL_DRAG_PER_S,
  OVERSPEED_DRAG_PER_MPS_OVER,
  POST_IMPACT_GRIP_SUPPRESSION_S,
  REVERSE_ACCELERATION_MPS2,
  STEERING_MAX_TURN_RATE_RAD_S,
  STEERING_RESPONSE_PER_S,
} from './MovementTuning';

export interface MovementSnapshot {
  headingRad: number;
  /** Unit vector the Bey is currently steering/facing toward — the "intended" direction, independent of where it's actually sliding. */
  intendedSteeringVector: Vec2;
  /** The Bey's actual measured horizontal velocity vector this tick. */
  actualVelocityVector: Vec2;
  speedMps: number;
  /** Angle (radians) between intendedSteeringVector and actualVelocityVector — 0 means driving exactly where it's facing; large means sliding/drifting. */
  slipAngleRad: number;
  lateralGripPerS: number;
  longitudinalDragPerS: number;
  isPostImpactCooldown: boolean;
  isGrounded: boolean;
  /** > 0 the tick a significant collision was detected (post-step actual velocity deviated from what we intended); 0 otherwise. */
  impactDeltaSpeedMps: number;
  /** Unit vector of the velocity deviation that triggered impactDeltaSpeedMps; zero vector when there was no impact this tick. */
  impactDirection: Vec2;
}

export class MovementController {
  private headingRad = 0;
  private turnRateRadPerS = 0;
  private postImpactCooldownRemainingS = 0;

  private lastHeadingForward: Vec2 = fromYaw(0);
  private lastLateralGripPerS = LATERAL_GRIP_PER_S;
  private intendedVelocityThisTick: Vec2 | null = null;

  /** Call before physics.step(). Reads/writes the body's linear velocity directly (the "hybrid" model GDD section 16 permits). */
  applyPreStep(
    body: RAPIER.RigidBody,
    actions: ControllerActions,
    fixedDeltaSeconds: number,
    grounded: boolean,
    lateralGripOverridePerS: number | null,
  ): void {
    const steerInput = (actions.held.has(Action.SteerRight) ? 1 : 0) - (actions.held.has(Action.SteerLeft) ? 1 : 0);
    const targetTurnRate = steerInput * STEERING_MAX_TURN_RATE_RAD_S;
    this.turnRateRadPerS += (targetTurnRate - this.turnRateRadPerS) * Math.min(1, STEERING_RESPONSE_PER_S * fixedDeltaSeconds);
    this.headingRad += this.turnRateRadPerS * fixedDeltaSeconds;
    const headingForward = fromYaw(this.headingRad);

    const throttleInput = (actions.held.has(Action.MoveForward) ? 1 : 0) - (actions.held.has(Action.MoveBackward) ? 1 : 0);

    const currentVel = body.linvel();
    const velHoriz: Vec2 = { x: currentVel.x, z: currentVel.z };
    const longitudinalSpeed = dot(velHoriz, headingForward);
    const longitudinalVec = scale(headingForward, longitudinalSpeed);
    const lateralVec: Vec2 = { x: velHoriz.x - longitudinalVec.x, z: velHoriz.z - longitudinalVec.z };

    const accelFactor = grounded ? 1 : AIRBORNE_ACCELERATION_FACTOR;
    let newLongitudinalSpeed = longitudinalSpeed;
    if (throttleInput > 0) {
      newLongitudinalSpeed += ACCELERATION_MPS2 * accelFactor * fixedDeltaSeconds;
    } else if (throttleInput < 0) {
      newLongitudinalSpeed -= REVERSE_ACCELERATION_MPS2 * accelFactor * fixedDeltaSeconds;
    }

    const speedAbs = Math.abs(newLongitudinalSpeed);
    if (speedAbs > INTENDED_MAX_SPEED_MPS) {
      const over = speedAbs - INTENDED_MAX_SPEED_MPS;
      newLongitudinalSpeed -= Math.sign(newLongitudinalSpeed) * over * OVERSPEED_DRAG_PER_MPS_OVER * fixedDeltaSeconds;
    }
    newLongitudinalSpeed *= Math.max(0, 1 - LONGITUDINAL_DRAG_PER_S * fixedDeltaSeconds);

    const lateralGripPerS = lateralGripOverridePerS ?? (grounded ? LATERAL_GRIP_PER_S : AIRBORNE_LATERAL_GRIP_PER_S);
    const newLateral = scale(lateralVec, Math.max(0, 1 - lateralGripPerS * fixedDeltaSeconds));

    const newVelHoriz = add(scale(headingForward, newLongitudinalSpeed), newLateral);

    this.lastHeadingForward = headingForward;
    this.lastLateralGripPerS = lateralGripPerS;

    if (this.postImpactCooldownRemainingS > 0) {
      // Back off: let the physics-resolved post-collision velocity play out untouched this tick.
      this.postImpactCooldownRemainingS = Math.max(0, this.postImpactCooldownRemainingS - fixedDeltaSeconds);
      this.intendedVelocityThisTick = null;
    } else {
      body.setLinvel({ x: newVelHoriz.x, y: currentVel.y, z: newVelHoriz.z }, true);
      this.intendedVelocityThisTick = newVelHoriz;
    }
  }

  /** Call after physics.step(). Reads the resulting velocity, detects collisions, and reports a full diagnostics snapshot. */
  postStep(body: RAPIER.RigidBody, grounded: boolean): MovementSnapshot {
    const vel = body.linvel();
    const actualVelocityVector: Vec2 = { x: vel.x, z: vel.z };
    const speedMps = length(actualVelocityVector);

    let impactDeltaSpeedMps = 0;
    let impactDirection: Vec2 = { x: 0, z: 0 };
    if (this.intendedVelocityThisTick) {
      const deltaVec: Vec2 = {
        x: actualVelocityVector.x - this.intendedVelocityThisTick.x,
        z: actualVelocityVector.z - this.intendedVelocityThisTick.z,
      };
      const delta = length(deltaVec);
      if (delta > IMPACT_VELOCITY_DELTA_THRESHOLD_MPS) {
        this.postImpactCooldownRemainingS = POST_IMPACT_GRIP_SUPPRESSION_S;
        impactDeltaSpeedMps = delta;
        impactDirection = scale(deltaVec, 1 / delta);
      }
    }

    const slipAngleRad = speedMps > 0.05 ? signedAngleBetween(this.lastHeadingForward, actualVelocityVector) : 0;

    return {
      headingRad: this.headingRad,
      intendedSteeringVector: this.lastHeadingForward,
      actualVelocityVector,
      speedMps,
      slipAngleRad,
      lateralGripPerS: this.lastLateralGripPerS,
      longitudinalDragPerS: LONGITUDINAL_DRAG_PER_S,
      isPostImpactCooldown: this.postImpactCooldownRemainingS > 0,
      isGrounded: grounded,
      impactDeltaSpeedMps,
      impactDirection,
    };
  }
}
