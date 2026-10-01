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
  AIRBORNE_ACCELERATION_FACTOR,
  DIRECTIONAL_STEER_GAIN_PER_S,
  DIRECTIONAL_STEERING_RESPONSE_PER_S,
  DIRECTIONAL_THRUST_ALIGNMENT_POWER,
  DIRECTIONAL_TURN_RATE_MULTIPLIER,
  IDLE_DAMPING_PER_S,
  IMPACT_TANGENTIAL_TRANSFER,
  IMPACT_VELOCITY_DELTA_THRESHOLD_MPS,
  LANDING_BOUNCE_MIN_AIRBORNE_TICKS,
  LANDING_BOUNCE_MIN_MPS,
  LANDING_SAME_LINE_COS,
  OVERSPEED_RETURN_PER_S,
  POST_IMPACT_GRIP_SUPPRESSION_S,
  SLIP_GRIP_LOSS_PER_S,
  SLIP_REGRIP_FRACTION,
  STEERING_RESPONSE_PER_S,
} from './MovementTuning';
import { DEFAULT_HANDLING_PROFILE, type BeyHandlingProfile } from '../archetype/BeyHandlingProfile';
import { labImpactSpeed, motionParams, motionRatio, type MotionParams } from '../motion/MotionPresets';
import { vec2, type CanonicalRecord } from '../../replay/state/CanonicalValue';
import { headingErrorRad, intentMagnitude } from './directionalIntent';

export interface MovementPreStepInput {
  actions: ControllerActions;
  fixedDeltaSeconds: number;
  grounded: boolean;
  /** From DriftController; null means "use normal grip". */
  lateralGripOverridePerS: number | null;
  /** From StaminaSystem's PhysicalCondition; 1 = no penalty. */
  staminaAccelFactor: number;
  /**
   * From AttackController during an active Dash Attack: forces heading and
   * longitudinal speed directly instead of reading steer/throttle input,
   * while still going through the same grip/physics pipeline (so wall
   * bounces etc. still work naturally). MovementController stays the sole
   * writer of horizontal velocity — AttackController never touches the
   * body directly, matching how DriftController only ever hands back a
   * grip override rather than writing velocity itself.
   */
  dashOverride: { headingRad: number; longitudinalSpeedMps: number } | null;
  /**
   * From DodgeController during the Dodging state's main flat-velocity
   * phase ("Fix 1" of the owner's movement/weight/dodge playtest pass):
   * the dodge's own direction (latched once, at the moment Dodge was
   * pressed) and speed replace the ENTIRE horizontal velocity this tick —
   * no steering, no throttle, no grip, no prior momentum. Takes priority
   * over dashOverride (a dash cannot be active while dodging) and is the
   * only override that bypasses the heading/steering/throttle computation
   * below entirely, not just its longitudinal result, since a dodge can
   * go sideways or backward relative to the current heading. Still goes
   * through the same post-step impact detection as everything else, so a
   * wall or another Bey genuinely interrupts/redirects it via physics —
   * this never sets position directly or skips collision.
   */
  dodgeOverride: { velocityMps: Vec2 } | null;
  /**
   * M11 lane 4: the floor's unit normal under the Bey while grounded (from
   * the arena's floor profile), or omitted/null. On a slope the driven
   * velocity is laid onto the floor's tangent plane, so the Bey rolls up
   * and down the bowl instead of ramming the ramp horizontally and
   * bouncing off it. A vertical normal (the flat arena) changes nothing.
   */
  floorNormal?: { x: number; y: number; z: number } | null;
}

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
  /** Motion Lab grip multiplier, 0..1 (1 = full lateral grip): drops while slipping and on impacts, recovers over time. */
  gripFactor: number;
  /** True while the tip has broken loose (sideways speed above the slip threshold, with hysteresis). */
  isSlipping: boolean;
  /** Whole-body rotation rate about vertical from impacts (the "rodopio"), rad/s — turns the heading. */
  whirlRadPerS: number;
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
  private lastLateralGripPerS: number;
  private intendedVelocityThisTick: Vec2 | null = null;
  /** Motion Lab grip state (motion-approval.md §3): multiplier on lateral grip, and the slip latch. */
  private grip = 1;
  private slipping = false;
  /** Motion Lab whirl: rotation of the whole body about vertical from glancing/strong impacts, damped. */
  private whirlRadPerS = 0;
  /** Vertical velocity the body carried into physics.step() (for the Motion Lab landing bounce in postStep). */
  private preStepVerticalMps = 0;
  /** The current post-impact window was opened by a knockback (a hit, a counter, a Clash): it plays out undamped. */
  private knockbackPlaying = false;
  /** Horizontal velocity the body carried into physics.step() (a landing keeps it — see applyLandingBounce). */
  private preStepHorizontal: Vec2 = { x: 0, z: 0 };
  /** Consecutive ticks that started airborne (a landing bounces only after a real fall). */
  private airborneTicks = 0;
  /** This Bey's handling with the motion direction applied (turn rate and lateral grip scale by the preset's ratio to B). */
  private readonly handling: BeyHandlingProfile;

  constructor(
    handling: BeyHandlingProfile = DEFAULT_HANDLING_PROFILE,
    private readonly motion: MotionParams = motionParams(),
  ) {
    this.handling = {
      ...handling,
      accelerationMps2: handling.accelerationMps2 * motionRatio(motion, 'accel'),
      maxSpeedMps: handling.maxSpeedMps * motionRatio(motion, 'maxSpeed'),
      turnRateRadS: handling.turnRateRadS * motionRatio(motion, 'turnRate'),
      lateralGripPerS: handling.lateralGripPerS * motionRatio(motion, 'lateralGrip'),
    };
    this.lastLateralGripPerS = this.handling.lateralGripPerS;
  }

  /** This Bey's lateral grip after the motion direction (DriftController's baseline). */
  getLateralGripPerS(): number {
    return this.handling.lateralGripPerS;
  }

  /** Current heading, live (not lagged behind a snapshot) — for consumers like AttackController's lock-on that need it mid-tick, before this tick's postStep(). */
  getHeadingRad(): number {
    return this.headingRad;
  }

  /** Debug Lab teleport/prepare (GDD section 70) — points the Bey's heading; explicit mutation, never called by gameplay. */
  debugSetHeading(headingRad: number): void {
    this.headingRad = headingRad;
    this.turnRateRadPerS = 0;
    this.lastHeadingForward = fromYaw(headingRad);
  }

  /**
   * A knockback (a hit, a counter, a Clash resolution) was just applied to
   * this body: let it play out like a detected collision — the next ticks
   * leave the velocity to physics (post-impact window) and grip drops as on
   * any impact. Without this the next pre-step re-wrote the horizontal
   * velocity (a Dash at full speed), so only the upward part of a counter's
   * knockback survived and a countered dasher flew on over the wall.
   */
  registerKnockback(): void {
    this.knockbackPlaying = true;
    this.postImpactCooldownRemainingS = POST_IMPACT_GRIP_SUPPRESSION_S;
    this.intendedVelocityThisTick = null;
    this.grip = Math.min(this.grip, this.motion.slipGrip);
  }

  /** Debug Lab "reset cooldowns" (GDD section 70) — explicit mutation, never called by gameplay. */
  debugResetCooldown(): void {
    this.postImpactCooldownRemainingS = 0;
    this.knockbackPlaying = false;
    this.grip = 1;
    this.slipping = false;
    this.whirlRadPerS = 0;
  }

  /** Read-only steering internals for Debug Lab inspection (GDD section 69). No gameplay code may branch on this. */
  getDebugState(): { turnRateRadPerS: number; postImpactCooldownRemainingS: number; grip: number; slipping: boolean; whirlRadPerS: number } {
    return {
      turnRateRadPerS: this.turnRateRadPerS,
      postImpactCooldownRemainingS: this.postImpactCooldownRemainingS,
      grip: this.grip,
      slipping: this.slipping,
      whirlRadPerS: this.whirlRadPerS,
    };
  }

  /** Call before physics.step(). Reads/writes the body's linear velocity directly (the "hybrid" model GDD section 16 permits). */
  applyPreStep(body: RAPIER.RigidBody, input: MovementPreStepInput): void {
    const { actions, fixedDeltaSeconds, grounded, lateralGripOverridePerS, staminaAccelFactor, dashOverride, dodgeOverride, floorNormal } = input;

    if (dodgeOverride) {
      this.applyDodgeOverride(body, dodgeOverride, grounded, fixedDeltaSeconds, floorNormal);
      return;
    }

    const intent = actions.moveIntent;
    let headingForward: Vec2;
    if (dashOverride) {
      this.headingRad = dashOverride.headingRad;
      this.turnRateRadPerS = 0;
      headingForward = fromYaw(this.headingRad);
    } else {
      // Classic: a turn key asks for the full turn rate. Directional (M11):
      // the heading turns toward the desired direction, asking for a turn
      // rate proportional to the error and capped at the Bey's own — same
      // easing, same limit, so a new direction still takes physical time.
      let targetTurnRate: number;
      if (intent) {
        const error = intentMagnitude(intent) > 0 ? headingErrorRad(intent, this.headingRad) : 0;
        const cap = this.handling.turnRateRadS * DIRECTIONAL_TURN_RATE_MULTIPLIER;
        targetTurnRate = Math.max(-cap, Math.min(cap, error * DIRECTIONAL_STEER_GAIN_PER_S));
      } else {
        const steerInput = (actions.held.has(Action.SteerRight) ? 1 : 0) - (actions.held.has(Action.SteerLeft) ? 1 : 0);
        targetTurnRate = steerInput * this.handling.turnRateRadS;
      }
      const response = intent ? DIRECTIONAL_STEERING_RESPONSE_PER_S : STEERING_RESPONSE_PER_S;
      this.turnRateRadPerS += (targetTurnRate - this.turnRateRadPerS) * Math.min(1, response * fixedDeltaSeconds);
      // Motion Lab whirl: an impact's rodopio turns the heading on top of
      // the steering, and dies out at the direction's angular damping.
      this.whirlRadPerS *= Math.exp(-this.motion.angularDamping * fixedDeltaSeconds);
      this.headingRad += (this.turnRateRadPerS + this.whirlRadPerS) * fixedDeltaSeconds;
      headingForward = fromYaw(this.headingRad);
    }

    // Classic: forward/back keys, full thrust. Directional: thrust scaled
    // by how hard the stick is pushed and by how well the heading already
    // faces the direction (cos of the error) — reverse thrust while the
    // direction is behind, none at 90°, full once facing it. Never above
    // one key's worth, so a diagonal is not faster.
    let throttleInput: number;
    let throttleScale = 1;
    if (intent) {
      const magnitude = intentMagnitude(intent);
      const alignment = magnitude > 0 ? Math.cos(headingErrorRad(intent, this.headingRad)) : 0;
      const drive = magnitude * Math.sign(alignment) * Math.abs(alignment) ** DIRECTIONAL_THRUST_ALIGNMENT_POWER;
      throttleInput = Math.sign(drive);
      throttleScale = Math.abs(drive);
    } else {
      throttleInput = (actions.held.has(Action.MoveForward) ? 1 : 0) - (actions.held.has(Action.MoveBackward) ? 1 : 0);
    }

    const hasMovementInput = intent
      ? intentMagnitude(intent) > 0
      : actions.held.has(Action.MoveForward) || actions.held.has(Action.MoveBackward) || actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight);

    const currentVel = body.linvel();
    const velHoriz: Vec2 = { x: currentVel.x, z: currentVel.z };
    const longitudinalSpeed = dot(velHoriz, headingForward);
    const longitudinalVec = scale(headingForward, longitudinalSpeed);
    const lateralVec: Vec2 = { x: velHoriz.x - longitudinalVec.x, z: velHoriz.z - longitudinalVec.z };

    // Motion Lab planar drive (motion-approval.md §5): thrust along the
    // heading only adds up to top speed; rolling drag acts only while
    // coasting (no throttle); an overspeed (a bounce, a knockback, a slope)
    // bleeds back toward top speed instead of hitting a wall.
    // A Dash drives along the ground: in the air (launched by a counter, a
    // bump) it keeps its heading lock but not its speed — the Motion Lab's
    // air model applies (15% thrust, no rolling drag), so a countered
    // dasher is not pushed on over the wall at Dash speed.
    let newLongitudinalSpeed: number;
    if (dashOverride && grounded) {
      newLongitudinalSpeed = dashOverride.longitudinalSpeedMps;
    } else {
      // Stamina degrades acceleration physically (GDD section 30) — never
      // by making input feel unresponsive, just genuinely weaker thrust.
      const accelFactor = (grounded ? 1 : AIRBORNE_ACCELERATION_FACTOR) * staminaAccelFactor;
      const maxSpeed = this.handling.maxSpeedMps;
      newLongitudinalSpeed = longitudinalSpeed;
      if (throttleInput > 0) {
        if (newLongitudinalSpeed < maxSpeed) {
          newLongitudinalSpeed = Math.min(maxSpeed, newLongitudinalSpeed + this.handling.accelerationMps2 * accelFactor * fixedDeltaSeconds * throttleScale);
        }
      } else if (throttleInput < 0) {
        newLongitudinalSpeed -= this.handling.reverseAccelerationMps2 * accelFactor * fixedDeltaSeconds * throttleScale;
      }
      if (grounded) {
        if (throttleInput === 0) newLongitudinalSpeed *= Math.exp(-this.motion.longitudinalGrip * fixedDeltaSeconds);
        // No movement input at all: the Bey settles instead of gliding on
        // (owner playtest: "it moves by itself"). Only on the ground and
        // outside an impact's window, so hits and bounces still play out.
        if (!hasMovementInput) newLongitudinalSpeed *= Math.exp(-IDLE_DAMPING_PER_S * fixedDeltaSeconds);
        const speedAbs = Math.abs(newLongitudinalSpeed);
        if (speedAbs > maxSpeed) {
          newLongitudinalSpeed -= Math.sign(newLongitudinalSpeed) * (speedAbs - maxSpeed) * (1 - Math.exp(-OVERSPEED_RETURN_PER_S * fixedDeltaSeconds));
        }
      }
    }

    // Lateral grip with slip (Motion Lab): sideways speed above the slip
    // threshold breaks the tip loose — the grip multiplier falls toward
    // slipGrip — and it re-grips only once well below it (hysteresis);
    // grip comes back at gripRecovery. A Dash Attack commits fully to its
    // locked-on line; a drift substitutes its own low grip.
    let lateralGripPerS: number;
    if (dashOverride && grounded) {
      lateralGripPerS = this.handling.lateralGripPerS * 4;
    } else if (!grounded) {
      this.slipping = false;
      lateralGripPerS = lateralGripOverridePerS ?? this.motion.airGrip;
    } else {
      const lateralSpeed = length(lateralVec);
      this.grip += (1 - this.grip) * (1 - Math.exp(-this.motion.gripRecovery * fixedDeltaSeconds));
      this.slipping = this.slipping
        ? lateralSpeed > this.motion.slipThreshold * SLIP_REGRIP_FRACTION
        : lateralSpeed > this.motion.slipThreshold;
      if (this.slipping) this.grip = Math.min(this.grip, Math.max(this.motion.slipGrip, this.grip - SLIP_GRIP_LOSS_PER_S * fixedDeltaSeconds));
      lateralGripPerS = lateralGripOverridePerS ?? this.handling.lateralGripPerS * this.grip;
    }
    const newLateral = scale(lateralVec, Math.exp(-lateralGripPerS * fixedDeltaSeconds));

    let newVelHoriz = add(scale(headingForward, newLongitudinalSpeed), newLateral);
    // Numerical safety clamp (motion-approval.md §3), not a gameplay limit.
    const newSpeed = length(newVelHoriz);
    if (newSpeed > this.motion.maxLinearSpeed) newVelHoriz = scale(newVelHoriz, this.motion.maxLinearSpeed / newSpeed);

    this.lastHeadingForward = headingForward;
    this.lastLateralGripPerS = lateralGripPerS;

    this.preStepVerticalMps = body.linvel().y;
    if (this.postImpactCooldownRemainingS > 0) {
      // Back off: let the physics-resolved post-collision velocity play out
      // untouched this tick. The velocity it carries in is still the
      // reference for impact detection, so a second collision inside the
      // window (a knockback into the wall) is still felt (M11).
      this.postImpactCooldownRemainingS = Math.max(0, this.postImpactCooldownRemainingS - fixedDeltaSeconds);
      this.intendedVelocityThisTick = velHoriz;
      // A bounce off the wall (or a Bey) with no movement input settles
      // like any other idle motion (owner playtest, after M11: released at
      // 11 m/s into the wall, a Bey came back at 7 m/s and slid ~3 m on its
      // own). A knockback from a hit still plays out untouched.
      if (!hasMovementInput && grounded && !this.knockbackPlaying) {
        const k = Math.exp(-IDLE_DAMPING_PER_S * fixedDeltaSeconds);
        body.setLinvel({ x: velHoriz.x * k, y: currentVel.y, z: velHoriz.z * k }, true);
        this.intendedVelocityThisTick = scale(velHoriz, k);
      }
      if (this.postImpactCooldownRemainingS === 0) this.knockbackPlaying = false;
    } else {
      const vertical = this.verticalFor(newVelHoriz, currentVel, grounded ? floorNormal : null);
      body.setLinvel({ x: newVelHoriz.x, y: vertical, z: newVelHoriz.z }, true);
      this.preStepVerticalMps = vertical;
      this.intendedVelocityThisTick = newVelHoriz;
    }
    const carried = body.linvel();
    this.preStepHorizontal = { x: carried.x, z: carried.z };
  }

  /**
   * Dodge's own flat-velocity phase ("Fix 1"): the latched direction and
   * DODGE_BURST_SPEED_MPS replace the entire horizontal velocity this
   * tick — no steering, no throttle, no grip, no prior momentum, heading
   * left exactly where it was (nothing is steering it). Still runs
   * through the same floor-slope projection as normal movement, and the
   * post-step impact detector still compares the actual result against
   * this intended velocity — a wall or another Bey genuinely interrupts
   * the dodge via physics, exactly like any other collision.
   */
  private applyDodgeOverride(
    body: RAPIER.RigidBody,
    dodgeOverride: { velocityMps: Vec2 },
    grounded: boolean,
    fixedDeltaSeconds: number,
    floorNormal: { x: number; y: number; z: number } | null | undefined,
  ): void {
    if (this.postImpactCooldownRemainingS > 0) {
      this.postImpactCooldownRemainingS = Math.max(0, this.postImpactCooldownRemainingS - fixedDeltaSeconds);
    }
    const currentVel = body.linvel();
    const newVelHoriz = dodgeOverride.velocityMps;
    this.lastHeadingForward = length(newVelHoriz) > 1e-6 ? scale(newVelHoriz, 1 / length(newVelHoriz)) : this.lastHeadingForward;
    this.lastLateralGripPerS = 0;
    const vertical = this.verticalFor(newVelHoriz, currentVel, grounded ? floorNormal : null);
    body.setLinvel({ x: newVelHoriz.x, y: vertical, z: newVelHoriz.z }, true);
    this.preStepVerticalMps = vertical;
    this.intendedVelocityThisTick = newVelHoriz;
    const carried = body.linvel();
    this.preStepHorizontal = { x: carried.x, z: carried.z };
  }

  /**
   * Vertical velocity to go with the driven horizontal velocity. Flat
   * ground (or airborne): the body's own, as always. Grounded on a slope:
   * the vertical component that keeps the velocity in the floor's tangent
   * plane (n · v = 0), plus whatever the body already had moving away from
   * the floor (a real bounce is kept; pushing into it is left to contact).
   */
  private verticalFor(horizontal: Vec2, current: { x: number; y: number; z: number }, n: { x: number; y: number; z: number } | null | undefined): number {
    if (!n || n.y >= 1 || n.y <= 0.5) return current.y;
    const along = -(n.x * horizontal.x + n.z * horizontal.z) / n.y;
    const separating = Math.max(0, current.x * n.x + current.y * n.y + current.z * n.z);
    return along + separating * n.y;
  }

  /**
   * Call after physics.step(). Reads the resulting velocity, detects collisions, and reports a full diagnostics snapshot.
   *
   * Known limitation: impact detection only compares horizontal (X/Z)
   * velocity, so a purely vertical impact (a hard floor landing with no
   * horizontal motion) never triggers impactDeltaSpeedMps here — floor
   * bounce is still handled by physics/restitution itself, this just means
   * SpinController.registerImpact()/telemetry won't fire for it. Revisit
   * once strong landings/vertical knockback matter (GDD section 20/109).
   */
  postStep(body: RAPIER.RigidBody, grounded: boolean): MovementSnapshot {
    this.applyLandingBounce(body);
    this.airborneTicks = grounded ? 0 : this.airborneTicks + 1;
    const vel = body.linvel();
    const actualVelocityVector: Vec2 = { x: vel.x, z: vel.z };

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
        this.applyImpactResponse(delta, impactDirection, this.intendedVelocityThisTick);
      }
    }

    return this.buildSnapshot(actualVelocityVector, grounded, impactDeltaSpeedMps, impactDirection);
  }

  /**
   * The Motion Lab's floor bounce (model.ts "Vertical"): when the floor
   * stopped a fall this step (the body went in descending and came out
   * with most of that descent gone — the floor collider itself never
   * bounces), it leaves upward at descent × floorBounce, or not at all
   * below LANDING_BOUNCE_MIN_MPS, so a Bey settles instead of buzzing.
   * Only after a real fall (airborne at least LANDING_BOUNCE_MIN_AIRBORNE_TICKS),
   * so a contact lost for a tick or two never turns into a bounce.
   */
  private applyLandingBounce(body: RAPIER.RigidBody): void {
    const descent = -this.preStepVerticalMps;
    if (descent <= 0 || this.airborneTicks < LANDING_BOUNCE_MIN_AIRBORNE_TICKS) return;
    const v = body.linvel();
    if (v.y < -descent * 0.5) return; // still falling: nothing stopped it
    // The Lab's landing keeps the horizontal speed; the floor collider's
    // friction took it with the impact (a hop landing at 6.4 m/s came out
    // at 4.2 — ~35% gone in one step, so a drift landing read as the Bey
    // stopping). Only when the step just slowed it along the same line: a
    // landing that also met a wall or a Bey keeps what physics decided.
    let x = v.x;
    let z = v.z;
    const before = Math.hypot(this.preStepHorizontal.x, this.preStepHorizontal.z);
    const after = Math.hypot(v.x, v.z);
    if (after > 0.1 && after < before && (v.x * this.preStepHorizontal.x + v.z * this.preStepHorizontal.z) > LANDING_SAME_LINE_COS * after * before) {
      x = (v.x / after) * before;
      z = (v.z / after) * before;
    }
    const bounce = descent * this.motion.floorBounce;
    body.setLinvel({ x, y: bounce < LANDING_BOUNCE_MIN_MPS ? v.y : Math.max(v.y, bounce), z }, true);
  }

  /**
   * Motion Lab impact response on the planar side (model.ts applyImpact):
   * grip drops to slipGrip; the glancing part of the hit (the incoming
   * velocity across the push direction) becomes whirl, and a hit above the
   * tumble threshold adds a rodopio on top. The tilt side lives in
   * SpinController.registerImpact.
   */
  private applyImpactResponse(impactDeltaSpeedMps: number, pushDirection: Vec2, incoming: Vec2): void {
    const m = this.motion;
    const speedMps = labImpactSpeed(impactDeltaSpeedMps, m);
    this.grip = Math.min(this.grip, m.slipGrip);
    const tangential = (pushDirection.x * incoming.z - pushDirection.z * incoming.x) * IMPACT_TANGENTIAL_TRANSFER;
    this.whirlRadPerS += m.linearToAngular * tangential;
    // The Lab turns a dead-centre hit (tangential 0) to +; here it adds no
    // rodopio, so mirrored fights stay mirrored.
    if (speedMps > m.tumbleThreshold) {
      this.whirlRadPerS += m.tumbleStrength * (speedMps - m.tumbleThreshold) * Math.sign(tangential);
    }
    this.whirlRadPerS = Math.max(-m.maxAngularSpeed, Math.min(m.maxAngularSpeed, this.whirlRadPerS));
  }

  /**
   * Read-only snapshot from current state — no impact detection, no
   * mutation of postImpactCooldownRemainingS or anything else. For
   * consumers (e.g. a frozen post-round snapshot) that must never advance
   * internal state; always reports impactDeltaSpeedMps 0 since no impact
   * detection is performed here.
   */
  getSnapshot(body: RAPIER.RigidBody, grounded: boolean): MovementSnapshot {
    const vel = body.linvel();
    const actualVelocityVector: Vec2 = { x: vel.x, z: vel.z };
    return this.buildSnapshot(actualVelocityVector, grounded, 0, { x: 0, z: 0 });
  }

  private buildSnapshot(
    actualVelocityVector: Vec2,
    grounded: boolean,
    impactDeltaSpeedMps: number,
    impactDirection: Vec2,
  ): MovementSnapshot {
    const speedMps = length(actualVelocityVector);
    const slipAngleRad = speedMps > 0.05 ? signedAngleBetween(this.lastHeadingForward, actualVelocityVector) : 0;

    return {
      headingRad: this.headingRad,
      intendedSteeringVector: this.lastHeadingForward,
      actualVelocityVector,
      speedMps,
      slipAngleRad,
      lateralGripPerS: this.lastLateralGripPerS,
      longitudinalDragPerS: this.motion.longitudinalGrip,
      isPostImpactCooldown: this.postImpactCooldownRemainingS > 0,
      isGrounded: grounded,
      gripFactor: this.grip,
      isSlipping: this.slipping,
      whirlRadPerS: this.whirlRadPerS,
      impactDeltaSpeedMps,
      impactDirection,
    };
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
  getDeterministicState(): CanonicalRecord {
    return {
      headingRad: this.headingRad,
      turnRateRadPerS: this.turnRateRadPerS,
      postImpactCooldownRemainingS: this.postImpactCooldownRemainingS,
      lastHeadingForward: vec2(this.lastHeadingForward),
      lastLateralGripPerS: this.lastLateralGripPerS,
      intendedVelocityThisTick: vec2(this.intendedVelocityThisTick),
      preStepVerticalMps: this.preStepVerticalMps,
      knockbackPlaying: this.knockbackPlaying,
      preStepHorizontal: vec2(this.preStepHorizontal),
      airborneTicks: this.airborneTicks,
      grip: this.grip,
      slipping: this.slipping,
      whirlRadPerS: this.whirlRadPerS,
    };
  }
}
