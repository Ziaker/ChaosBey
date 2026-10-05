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

import { DRIFT_TURN_RATE_MULTIPLIER } from '../../drift/DriftTuning';
import type RAPIER from '@dimforge/rapier3d-compat';
import { type ControllerActions, Action } from '../../input/actions/Action';
import { add, dot, fromYaw, length, scale, signedAngleBetween, type Vec2 } from '../../physics/Vec2';
import {
  AIRBORNE_ACCELERATION_FACTOR,
  DIRECTIONAL_STEER_GAIN_PER_S,
  DIRECTIONAL_STEERING_RESPONSE_PER_S,
  DIRECTIONAL_THRUST_ALIGNMENT_POWER,
  DIRECTIONAL_TURN_RATE_MULTIPLIER,
  GRIP_RECOVERY_MULTIPLIER,
  IDLE_DAMPING_PER_S,
  IMPACT_TANGENTIAL_TRANSFER,
  IMPACT_VELOCITY_DELTA_THRESHOLD_MPS,
  LANDING_BOUNCE_MIN_AIRBORNE_TICKS,
  LANDING_BOUNCE_MIN_MPS,
  LANDING_SAME_LINE_COS,
  OVERSPEED_RETURN_PER_S,
  POST_IMPACT_GRIP_SUPPRESSION_S,
  SLIP_GRIP_FLOOR_MULTIPLIER,
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
  /** From DriftController (match Beys, owner 2026-10-04): × the Bey's own grip while drifting / recovering. */
  driftGripFraction?: number | null;
  /** The Bey is drifting (DriftState.Drifting): sharper turn, no speed lost in the curve. */
  drifting?: boolean;
  /** From StaminaSystem's PhysicalCondition; 1 = no penalty. */
  staminaAccelFactor: number;
  /** From MomentumSystem (owner, 2026-10-02): the top speed is the handling's × this. Omitted = 1. */
  topSpeedMultiplier?: number;
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

/** Numerical safety clamp on horizontal speed (m/s) — not a gameplay limit (owner speed pass, 2026-10-04). */
const NUMERICAL_SPEED_CLAMP_MPS = 60;

/** × the grip recovery while steering after a knockback (match handling). PROVISIONAL. */
const STEERED_REGRIP_MULTIPLIER = 4;

/** Match handling: thrust = stick magnitude ^ this (see the thrust curve in applyPreStep). PROVISIONAL. */
const STICK_THRUST_EXPONENT = 0.35;

/** Self-launched off the terrain (see selfLaunched): air grip × this and air thrust at this share. PROVISIONAL. */
const SELF_LAUNCHED_AIR_GRIP_MULTIPLIER = 3;
const SELF_LAUNCHED_AIR_ACCELERATION_FACTOR = 0.5;

/** The Clash loser's stun ends at the latest after this long if it never left the ground (s). PROVISIONAL. */
const CLASH_STUN_MAX_S = 1.5;

/** Speed lost per radian of curve at 0% kept (× (1 − turnSpeedRetention)). PROVISIONAL. */
const TURN_LOSS_PER_RAD = 0.15;

/**
 * Owner, 2026-10-04. The ×3.6 gravity had also multiplied the floor friction: a hidden brake every Bey's thrust was
 * tuned against (Acceleration ×1.9 felt the way it did because ~19 m/s² of it was being eaten), and that bled the
 * speed in every curve. The friction is now as at ×1 (PhysicsWorld.frictionScale); this keeps the straight-line
 * acceleration the owner tuned — the thrust minus the old brake, ×`netBoost` (+20%: "no mínimo 20% mais rápido") —
 * while a curve no longer pays the brake. Grounded only (the air never had floor friction).
 */
export interface ThrustCalibration {
  /** The floor friction deceleration the old tuning included (m/s²). */
  readonly oldBrakeMps2: number;
  /** The floor friction deceleration that remains (m/s²). */
  readonly newBrakeMps2: number;
  /** × the old net straight-line acceleration. */
  readonly netBoost: number;
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
  /**
   * Owner, 2026-10-05 (drift for speed build-up): the speed the floor contact took from the last drifting step (the
   * leaning, sliding tip brakes it in the physics step) — the next drifting step gives it back. 0 outside a drift.
   */
  private driftFloorLossMps = 0;
  /** This step was a drift on the ground with the match handling (see driftFloorLossMps). */
  private driftingThisStep = false;
  /** The current post-impact window was opened by a knockback (a hit, a counter, a Clash): it plays out undamped. */
  private knockbackPlaying = false;
  /** Horizontal velocity the body carried into physics.step() (a landing keeps it — see applyLandingBounce). */
  private preStepHorizontal: Vec2 = { x: 0, z: 0 };
  /** Consecutive ticks that started airborne (a landing bounces only after a real fall). */
  private airborneTicks = 0;
  /** This tick's flight is the Bey's own jump/hop (DriftController Hopping), see postStep. */
  private ownJumpFlight = false;
  /** A knockback landed since the current own jump began: its landing bounces physically. */
  private knockedThisJump = false;
  /** This Bey's handling with the motion direction applied (turn rate and lateral grip scale by the preset's ratio to B). */
  private readonly handling: BeyHandlingProfile;

  /** MatchConfig.airControl (Lote 9): scales the grip in the air — how much the Bey can steer its flight. */
  private readonly airControl: number;
  /** Owner, 2026-10-04 (MatchConfig.turnSpeedRetention): share of the speed a grounded, driven turn would lose that it keeps. */
  private readonly turnSpeedRetention: number;
  /** Owner, 2026-10-04 (MatchConfig.highSpeedControl): 1 = control does not fall with speed (no slip loss, grip scales with speed). */
  private readonly highSpeedControl: number;
  private readonly thrustCalibration: ThrustCalibration | null;
  /**
   * Owner, 2026-10-04 ("não é pra ser possível realizar nenhum movimento (no caso do perdedor) até se recuperar no
   * ar"): the Clash loser takes no input at all — the only thing it can do is the Air Recovery — until it recovers in
   * the air or lands again (or CLASH_STUN_MAX_S passes if it never left the ground).
   */
  private clashStunned = false;
  private clashStunElapsedS = 0;
  private clashStunLeftGround = false;
  /** Seconds during which Attack, Dodge and Jump are ignored (the Clash winner's / a tie's recovery). */
  private actionLockS = 0;

  constructor(
    handling: BeyHandlingProfile = DEFAULT_HANDLING_PROFILE,
    private readonly motion: MotionParams = motionParams(),
    /** Owner, 2026-10-02 (Lote 9 / GDD 12): the match's acceleration, top speed and air control multipliers (1 = as designed). */
    scales: { readonly acceleration: number; readonly topSpeed: number; readonly airControl: number; readonly turnRate?: number; readonly turnSpeedRetention?: number; readonly highSpeedControl?: number; readonly thrustCalibration?: ThrustCalibration } = { acceleration: 1, topSpeed: 1, airControl: 1 },
  ) {
    this.airControl = scales.airControl;
    this.turnSpeedRetention = Math.max(0, Math.min(1, scales.turnSpeedRetention ?? 0));
    this.highSpeedControl = Math.max(0, Math.min(1, scales.highSpeedControl ?? 0));
    this.thrustCalibration = scales.thrustCalibration ?? null;
    this.handling = {
      ...handling,
      accelerationMps2: handling.accelerationMps2 * motionRatio(motion, 'accel') * scales.acceleration,
      reverseAccelerationMps2: handling.reverseAccelerationMps2 * scales.acceleration,
      maxSpeedMps: handling.maxSpeedMps * motionRatio(motion, 'maxSpeed') * scales.topSpeed,
      turnRateRadS: handling.turnRateRadS * motionRatio(motion, 'turnRate') * (scales.turnRate ?? 1),
      // Owner, 2026-10-04: a faster turn rate comes with grip to match, so turning quicker does not mean sliding more.
      lateralGripPerS: handling.lateralGripPerS * motionRatio(motion, 'lateralGrip') * (scales.turnRate ?? 1),
    };
    this.lastLateralGripPerS = this.handling.lateralGripPerS;
  }

  /** This Bey's lateral grip after the motion direction (DriftController's baseline). */
  getLateralGripPerS(): number {
    return this.handling.lateralGripPerS;
  }

  /** Current heading, live (not lagged behind a snapshot) — for consumers like AttackController's lock-on that need it mid-tick, before this tick's postStep(). */
  /** The handling's top speed (m/s, motion direction included), before momentum. */
  /**
   * Owner, 2026-10-04: airborne on its own — off the funnel's slope or rim at speed, not from its own jump and not
   * thrown by a hit. The arrows keep steering it (it used to barely respond in the air). Match handling only.
   */
  private selfLaunched(): boolean {
    return this.highSpeedControl > 0 && !this.knockbackPlaying && !this.ownJumpFlight;
  }

  /** The Clash loser: locked out of every input — no Air Recovery either (owner, 2026-10-05) — until it lands. */
  startClashStun(): void {
    this.clashStunned = true;
    this.clashStunElapsedS = 0;
    this.clashStunLeftGround = false;
  }

  /** An Air Recovery (or anything that hands control back) ends the Clash stun. */
  endClashStun(): void {
    this.clashStunned = false;
  }

  isClashStunned(): boolean {
    return this.clashStunned;
  }

  /** Attack, Dodge and Jump are being ignored right now (the post-Clash recovery or stun). */
  areActionsLocked(): boolean {
    return this.clashStunned || this.actionLockS > 0;
  }

  /** Attack, Dodge and Jump are ignored for `seconds` (movement still works). */
  lockActionsFor(seconds: number): void {
    this.actionLockS = Math.max(this.actionLockS, seconds);
  }

  /** This tick's input after the post-Clash locks (call once per normal tick, before anything reads the input). */
  filterPostClashActions(actions: ControllerActions, grounded: boolean, fixedDeltaSeconds: number): ControllerActions {
    if (this.clashStunned) {
      this.clashStunElapsedS += fixedDeltaSeconds;
      if (!grounded) this.clashStunLeftGround = true;
      else if (this.clashStunLeftGround || this.clashStunElapsedS >= CLASH_STUN_MAX_S) this.clashStunned = false;
    }
    this.actionLockS = Math.max(0, this.actionLockS - fixedDeltaSeconds);
    if (this.clashStunned) {
      // Owner, 2026-10-05 ("Remova a capacidade de dar recovery ao perder um clash"): nothing reaches the Bey, the
      // Dodge (Air Recovery) included, until it lands (or CLASH_STUN_MAX_S).
      return { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
    }
    if (this.actionLockS > 0) {
      const blocked = (a: Action): boolean => a === Action.Attack || a === Action.Dodge || a === Action.JumpDrift;
      return {
        ...actions,
        held: new Set([...actions.held].filter((a) => !blocked(a))),
        pressedThisFrame: new Set([...actions.pressedThisFrame].filter((a) => !blocked(a))),
        attackHoldDurationSeconds: 0,
        jumpDriftHoldDurationSeconds: 0,
      };
    }
    return actions;
  }

  /** Forward thrust (m/s²) after the friction calibration (see ThrustCalibration); never below a quarter of the raw. */
  private groundThrust(rawMps2: number, grounded: boolean): number {
    const c = this.thrustCalibration;
    if (!c || !grounded) return rawMps2;
    return Math.max(0.25 * rawMps2, (rawMps2 - c.oldBrakeMps2) * c.netBoost + c.newBrakeMps2);
  }

  getMaxSpeedMps(): number {
    return this.handling.maxSpeedMps;
  }

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
  /** @param controlLossScale × the control-loss window (MatchConfig.bodyContactControlLossScale for a plain body contact). */
  registerKnockback(controlLossScale = 1): void {
    this.knockedThisJump = true;
    this.knockbackPlaying = true;
    this.postImpactCooldownRemainingS = Math.max(this.postImpactCooldownRemainingS, POST_IMPACT_GRIP_SUPPRESSION_S * controlLossScale);
    this.intendedVelocityThisTick = null;
    this.grip = Math.min(this.grip, this.motion.slipGrip);
  }

  /** True while a knockback (a hit, a launch) is playing out. */
  isKnockbackPlaying(): boolean {
    return this.knockbackPlaying;
  }

  /** Owner, 2026-10-04: an Air Recovery ends the launch — the knockback stops playing and control comes back at once. */
  endKnockback(): void {
    this.postImpactCooldownRemainingS = 0;
    this.knockbackPlaying = false;
    this.grip = 1;
    this.slipping = false;
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
    // Owner, 2026-10-04 ("o drift está completamente defasado … mais recompensador"): with the match handling on, a drift
    // turns sharper and loses no speed in the curve (the slide comes from the reduced grip, not from braking).
    const rewardingDrift = input.drifting === true && this.turnSpeedRetention > 0;
    const driftTurn = rewardingDrift ? DRIFT_TURN_RATE_MULTIPLIER : 1;
    const topSpeedMultiplier = input.topSpeedMultiplier ?? 1;

    this.driftingThisStep = false;
    if (dodgeOverride) {
      this.driftFloorLossMps = 0;
      this.applyDodgeOverride(body, dodgeOverride, grounded, fixedDeltaSeconds, floorNormal);
      return;
    }

    // Owner, 2026-10-04: a Dash fired right after a wall bounce takes over at once — the post-impact "let the bounce
    // play out" window used to swallow it, so the Bey kept flying the way the wall sent it (the opposite way).
    // A real knockback (a hit, a Circular's launch) still plays out.
    if (dashOverride && !this.knockbackPlaying) this.postImpactCooldownRemainingS = 0;
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
        targetTurnRate = Math.max(-cap * driftTurn, Math.min(cap * driftTurn, error * DIRECTIONAL_STEER_GAIN_PER_S * driftTurn));
      } else {
        const steerInput = (actions.held.has(Action.SteerRight) ? 1 : 0) - (actions.held.has(Action.SteerLeft) ? 1 : 0);
        targetTurnRate = steerInput * this.handling.turnRateRadS * driftTurn;
      }
      const response = intent ? DIRECTIONAL_STEERING_RESPONSE_PER_S : STEERING_RESPONSE_PER_S;
      this.turnRateRadPerS += (targetTurnRate - this.turnRateRadPerS) * Math.min(1, response * fixedDeltaSeconds);
      // Motion Lab whirl: an impact's rodopio turns the heading on top of
      // the steering, and dies out at the direction's angular damping.
      this.whirlRadPerS *= Math.exp(-this.motion.angularDamping * fixedDeltaSeconds);
      // Owner, 2026-10-04 ("o bey perde completamente o controle e a própria orientação de movimento quando leva um
      // ataque e aterrissa, ele não vai pras direções certas que estou apertando"): an impact's rodopio (up to ~18 rad/s
      // off a wall or a Bey) turned the heading against the stick for about a second. With the match handling it no
      // longer steers the Bey while a direction is held — the player owns the heading.
      const steering = intent ? intentMagnitude(intent) > 0 : actions.held.has(Action.MoveForward) || actions.held.has(Action.MoveBackward) || actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight);
      const whirlTurn = this.highSpeedControl > 0 && steering ? 0 : this.whirlRadPerS;
      this.headingRad += (this.turnRateRadPerS + whirlTurn) * fixedDeltaSeconds;
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
      // Owner audit, 2026-10-04: a light stick couldn't leave the funnel's centre (35% → 0 m/s, 60% → stuck after 2.7 m:
      // the ×3.6 gravity's pull down the slope beat a linear 35–60% thrust). With the match handling the thrust follows
      // the stick on a curve that rises fast (35% → 69%, 60% → 84%, full = full); keyboard input is always full.
      const rawMagnitude = intentMagnitude(intent);
      const magnitude = this.highSpeedControl > 0 ? rawMagnitude ** STICK_THRUST_EXPONENT : rawMagnitude;
      const alignment = magnitude > 0 ? Math.cos(headingErrorRad(intent, this.headingRad)) : 0;
      // Owner, 2026-10-04 ("curvas não deviam reduzir tanto a velocidade"): with speed kept in turns, a new direction
      // behind the Bey no longer brakes it in reverse — it turns toward it and keeps going (thrust resumes as it faces it).
      const steered = this.turnSpeedRetention > 0 ? Math.max(0, alignment) : alignment;
      const drive = magnitude * Math.sign(steered) * Math.abs(steered) ** DIRECTIONAL_THRUST_ALIGNMENT_POWER;
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
    if (dashOverride && (grounded || !this.knockbackPlaying)) {
      newLongitudinalSpeed = dashOverride.longitudinalSpeedMps;
    } else {
      // Stamina degrades acceleration physically (GDD section 30) — never
      // by making input feel unresponsive, just genuinely weaker thrust.
      const accelFactor = (grounded ? 1 : this.selfLaunched() ? SELF_LAUNCHED_AIR_ACCELERATION_FACTOR : AIRBORNE_ACCELERATION_FACTOR) * staminaAccelFactor;
      const maxSpeed = this.handling.maxSpeedMps * topSpeedMultiplier;
      newLongitudinalSpeed = longitudinalSpeed;
      if (throttleInput > 0) {
        if (newLongitudinalSpeed < maxSpeed) {
          newLongitudinalSpeed = Math.min(maxSpeed, newLongitudinalSpeed + this.groundThrust(this.handling.accelerationMps2 * accelFactor, grounded) * fixedDeltaSeconds * throttleScale);
        }
      } else if (throttleInput < 0) {
        newLongitudinalSpeed -= this.handling.reverseAccelerationMps2 * accelFactor * fixedDeltaSeconds * throttleScale;
      }
      if (grounded) {
        // Owner, 2026-10-04: with speed kept in turns, pointing the stick sideways (or behind) to curve is steering, not
        // letting go — no coasting drag while a direction is held.
        const steeringOnly = this.turnSpeedRetention > 0 && hasMovementInput && throttleInput === 0;
        if (throttleInput === 0 && !steeringOnly) newLongitudinalSpeed *= Math.exp(-this.motion.longitudinalGrip * fixedDeltaSeconds);
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
    if (dashOverride && (grounded || !this.knockbackPlaying)) {
      // Owner, 2026-10-04: the Dash commits to its line at once (no curved slide from the speed it had before).
      lateralGripPerS = this.handling.lateralGripPerS * 12;
    } else if (!grounded) {
      this.slipping = false;
      lateralGripPerS = lateralGripOverridePerS ?? this.motion.airGrip * this.airControl * (this.selfLaunched() ? SELF_LAUNCHED_AIR_GRIP_MULTIPLIER : 1);
    } else {
      const lateralSpeed = length(lateralVec);
      // Owner, 2026-10-04: once a knockback is over, a Bey that is being steered gets its grip back fast (it slid on in
      // the hit's direction for ~0.8 s after landing). Match handling only.
      const steeredRegrip = this.highSpeedControl > 0 && hasMovementInput && !this.knockbackPlaying ? STEERED_REGRIP_MULTIPLIER : 1;
      this.grip += (1 - this.grip) * (1 - Math.exp(-this.motion.gripRecovery * GRIP_RECOVERY_MULTIPLIER * steeredRegrip * fixedDeltaSeconds));
      this.slipping = this.slipping
        ? lateralSpeed > this.motion.slipThreshold * SLIP_REGRIP_FRACTION
        : lateralSpeed > this.motion.slipThreshold;
      // Owner, 2026-10-04: "por que o controle de movimento do bey é perdido ou reduzido quanto mais rápido ele fica? eu
      // NUNCA pedi isso". At speed every turn crosses the slip threshold (a fixed 2.5 m/s sideways) and grip fell to
      // ~1/3, and a fixed grip leaves more sideways slide the faster the Bey goes. With highSpeedControl the slip loss
      // is gone and the grip grows with speed, so a fast Bey turns as cleanly as a slow one. A drift keeps its own grip.
      const slipFloorBase = Math.min(1, this.motion.slipGrip * SLIP_GRIP_FLOOR_MULTIPLIER);
      const slipFloor = slipFloorBase + (1 - slipFloorBase) * this.highSpeedControl;
      if (this.slipping) this.grip = Math.min(this.grip, Math.max(slipFloor, this.grip - SLIP_GRIP_LOSS_PER_S * fixedDeltaSeconds));
      const speedGrip = 1 + Math.max(0, length(velHoriz) / Math.max(1e-6, this.handling.maxSpeedMps) - 1) * this.highSpeedControl;
      lateralGripPerS = lateralGripOverridePerS ?? this.handling.lateralGripPerS * this.grip * speedGrip * (input.driftGripFraction ?? 1);
    }
    const newLateral = scale(lateralVec, Math.exp(-lateralGripPerS * fixedDeltaSeconds));

    let newVelHoriz = add(scale(headingForward, newLongitudinalSpeed), newLateral);
    // Owner, 2026-10-04: "curvas não deviam reduzir tanto a velocidade". A driven turn on the ground keeps this share of
    // the speed the heading change and the lateral grip scrub off (never above the top speed, never on a Dash).
    // Owner, 2026-10-04 ("está impossível buildar momentum com o bey perdendo velocidade a cada toquezinho que você dá
    // pra curvar"): it used to keep 90% of each TICK's loss, which compounds — a steady curve lost ~11 m/s per second.
    // Now the loss is per radian the velocity actually turns: (1 − kept) × TURN_LOSS_PER_RAD of the speed per radian
    // (at 90%: ~2.4% over a 90° curve, ~4.7% over a U-turn), nothing at 100%.
    // Only for a Bey going forward: one thrown backward (a knockback, a bounce) that the player drives against must be
    // allowed to brake and turn around — keeping its speed made it ACCELERATE backward while the stick asked forward
    // (owner, 2026-10-04: "ele não vai pras direções certas que estou apertando" after a hit).
    if (this.turnSpeedRetention > 0 && grounded && !dashOverride && hasMovementInput && longitudinalSpeed > 0) {
      const before = length(velHoriz);
      const after = length(newVelHoriz);
      const cap = this.handling.maxSpeedMps * topSpeedMultiplier;
      if (after > 1e-6 && before > 1e-6 && after < before) {
        const cos = Math.max(-1, Math.min(1, dot(velHoriz, newVelHoriz) / (before * after)));
        const turnedRad = Math.acos(cos);
        // The thrust gained this tick stays on top (it used to be clipped back to the speed before the tick, so a long
        // curve could only ever lose speed).
        const thrustGain = Math.max(0, newLongitudinalSpeed - Math.max(0, longitudinalSpeed));
        const kept = rewardingDrift ? 1 : this.turnSpeedRetention;
        const allowed = before * (1 - (1 - kept) * TURN_LOSS_PER_RAD * turnedRad) + thrustGain;
        const keptSpeed = Math.min(Math.max(after, cap), Math.max(after, allowed));
        if (keptSpeed > after) newVelHoriz = scale(newVelHoriz, keptSpeed / after);
      }
    }
    // Owner, 2026-10-05 ("ajeite o drift para que seja … mais útil para build-up de velocidade"): a drift accelerates at
    // full thrust whatever its slide angle (thrust only counted along the heading, and the slide puts the velocity off
    // it), and the floor contact of the leaning tip no longer brakes it (measured: −0.06 m/s every step at 20 m/s, so a
    // long drift lost speed while a plain curve gained it). Up to the top speed, never on a Dash.
    this.driftingThisStep = rewardingDrift && grounded && !dashOverride && hasMovementInput && this.postImpactCooldownRemainingS === 0;
    if (this.driftingThisStep) {
      const before = length(velHoriz);
      const after = length(newVelHoriz);
      const cap = this.handling.maxSpeedMps * topSpeedMultiplier;
      const stick = intent ? (this.highSpeedControl > 0 ? intentMagnitude(intent) ** STICK_THRUST_EXPONENT : intentMagnitude(intent)) : throttleInput > 0 ? 1 : 0;
      const fullThrust = this.groundThrust(this.handling.accelerationMps2 * staminaAccelFactor, true) * fixedDeltaSeconds * stick;
      const target = Math.min(Math.max(after, cap), before + fullThrust + this.driftFloorLossMps);
      if (after > 1e-6 && target > after) newVelHoriz = scale(newVelHoriz, target / after);
    } else {
      this.driftFloorLossMps = 0;
    }
    // Numerical safety clamp (motion-approval.md §3), not a gameplay limit.
    const newSpeed = length(newVelHoriz);
    // Owner, 2026-10-04: the +45% speed and the bigger momentum need room above the Lab's 26 m/s (numerical safety only).
    const safetyMps = Math.max(this.motion.maxLinearSpeed, NUMERICAL_SPEED_CLAMP_MPS);
    if (newSpeed > safetyMps) newVelHoriz = scale(newVelHoriz, safetyMps / newSpeed);

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
  postStep(body: RAPIER.RigidBody, grounded: boolean, ownJumpFlight = false): MovementSnapshot {
    // Owner, 2026-10-02 (Lote 4): one X press = one flight. Landing from the Bey's own jump or hop never bounces (the
    // floor bounce relaunched it up to 13 cm after a full jump: "pula duas vezes"); knockback and falls still do.
    // Latched from the hop's takeoff through the step where the floor stops the fall: the ground check reads
    // "grounded" a tick before that step, when DriftController has already left Hopping.
    if (ownJumpFlight && !this.ownJumpFlight) this.knockedThisJump = false;
    if (ownJumpFlight) this.ownJumpFlight = true;
    this.applyLandingBounce(body);
    if (grounded && this.airborneTicks === 0 && !ownJumpFlight) this.ownJumpFlight = false;
    this.airborneTicks = grounded ? 0 : this.airborneTicks + 1;
    const vel = body.linvel();
    const actualVelocityVector: Vec2 = { x: vel.x, z: vel.z };
    // See driftFloorLossMps: what this drifting step's floor contact took (a real impact is not that).
    if (this.driftingThisStep && this.intendedVelocityThisTick) {
      const loss = length(this.intendedVelocityThisTick) - length(actualVelocityVector);
      this.driftFloorLossMps = loss > 0 && loss < IMPACT_VELOCITY_DELTA_THRESHOLD_MPS ? loss : 0;
    }

    let impactDeltaSpeedMps = 0;
    let impactDirection: Vec2 = { x: 0, z: 0 };
    if (this.intendedVelocityThisTick) {
      const deltaVec: Vec2 = {
        x: actualVelocityVector.x - this.intendedVelocityThisTick.x,
        z: actualVelocityVector.z - this.intendedVelocityThisTick.z,
      };
      const delta = length(deltaVec);
      if (delta > IMPACT_VELOCITY_DELTA_THRESHOLD_MPS) {
        // Owner, 2026-10-04 ("do nada ele perde o controle e para de responder meus comandos de movimentação pelas
        // setas quando fica muito rápido"): at speed every curve runs up the funnel into the rim's wall, and each of
        // those plain impacts took the controls away for 0.35 s and cut the grip to a third (~32% of a fast lap was
        // spent that way). With the match handling a wall / floor impact no longer does either — the bounce is in the
        // velocity and the player steers on from it. Hits and launches (knockbackPlaying) keep their own control loss.
        const environmental = this.highSpeedControl > 0 && !this.knockbackPlaying;
        if (!environmental) this.postImpactCooldownRemainingS = POST_IMPACT_GRIP_SUPPRESSION_S;
        impactDeltaSpeedMps = delta;
        impactDirection = scale(deltaVec, 1 / delta);
        this.applyImpactResponse(delta, impactDirection, this.intendedVelocityThisTick, environmental);
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
    if (this.ownJumpFlight && !this.knockedThisJump) {
      body.setLinvel({ x, y: Math.min(v.y, 0), z }, true);
      this.ownJumpFlight = false;
      return;
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
  private applyImpactResponse(impactDeltaSpeedMps: number, pushDirection: Vec2, incoming: Vec2, keepGrip = false): void {
    const m = this.motion;
    const speedMps = labImpactSpeed(impactDeltaSpeedMps, m);
    if (!keepGrip) this.grip = Math.min(this.grip, m.slipGrip);
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
      ownJumpFlight: this.ownJumpFlight,
      knockedThisJump: this.knockedThisJump,
      headingRad: this.headingRad,
      turnRateRadPerS: this.turnRateRadPerS,
      postImpactCooldownRemainingS: this.postImpactCooldownRemainingS,
      lastHeadingForward: vec2(this.lastHeadingForward),
      lastLateralGripPerS: this.lastLateralGripPerS,
      intendedVelocityThisTick: vec2(this.intendedVelocityThisTick),
      preStepVerticalMps: this.preStepVerticalMps,
      driftFloorLossMps: this.driftFloorLossMps,
      driftingThisStep: this.driftingThisStep,
      knockbackPlaying: this.knockbackPlaying,
      preStepHorizontal: vec2(this.preStepHorizontal),
      airborneTicks: this.airborneTicks,
      grip: this.grip,
      slipping: this.slipping,
      whirlRadPerS: this.whirlRadPerS,
      clashStunned: this.clashStunned,
      clashStunElapsedS: this.clashStunElapsedS,
      clashStunLeftGround: this.clashStunLeftGround,
      actionLockS: this.actionLockS,
    };
  }
}
