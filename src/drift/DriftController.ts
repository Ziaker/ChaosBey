// ============================================================
// DRIFT / JUMP CONTROLLER
// State machine for the hop -> hold -> drift -> recover flow (GDD section
// 19), plus the Milestone 3 variable-height jump that sits on top of the
// same hop (see DriftTuning.ts). Talks to MovementController only through
// the lateralGripOverridePerS value it hands back each tick — it never
// touches heading/thrust itself, keeping drift/jump and movement
// independently diagnosable (GDD section 17.4 component separation).
//
// Jump vs. drift share the same liftoff (JumpDrift/X) but are told apart
// by a turn (GDD section 19 vs. 20): holding X and going straight keeps
// adding height (variable jump), standing or moving; turning during the X
// press — measured against the direction latched when X was pressed —
// arms the drift: height assist stops and the hop stays at its small
// liftoff, and the drift then lasts as long as X is held (owner playtest,
// after M11).
//
// Landing is detected generically, independent of DriftState: any
// grounded<-airborne transition (a hop, a knockback launch, falling off a
// ledge) reports justLanded plus descent speed/intensity/jump-assist data
// for Milestone 4's VFX/camera to react to — it never gates on being in
// the Hopping state, and carries no handling penalty of its own.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import { Action, type ControllerActions } from '../input/actions/Action';
import { DIRECTIONAL_STEERING_THRESHOLD_RAD, LATERAL_GRIP_PER_S } from '../bey/movement/MovementTuning';
import {
  DRIFT_AIRBORNE_GRACE_S,
  DRIFT_REFERENCE_MIN_SPEED_MPS,
  DRIFT_GRIP_RECOVERY_DURATION_S,
  DRIFT_LATERAL_GRIP_PER_S,
  HOP_IMPULSE_MPS,
  HOP_MIN_AIRBORNE_DURATION_S,
  JUMP_ASSIST_ACCEL_MPS2,
  JUMP_ASSIST_MAX_DURATION_S,
  LANDING_INTENSITY_REFERENCE_DESCENT_SPEED_MPS,
} from './DriftTuning';
import type { CanonicalRecord } from '../replay/state/CanonicalValue';

export enum DriftState {
  Idle = 'Idle',
  Hopping = 'Hopping',
  Drifting = 'Drifting',
  Recovering = 'Recovering',
}

export interface DriftTickResult {
  /** Passed straight to MovementController.applyPreStep's lateralGripOverridePerS parameter; null means "use normal grip". */
  lateralGripOverridePerS: number | null;
  driftState: DriftState;
  /** True for exactly one tick: this Bey just transitioned from airborne to grounded — any cause (a hop, a knockback launch, falling off a ledge), independent of DriftState. */
  justLanded: boolean;
  /** Descent speed (m/s, >= 0) measured the tick before touchdown was detected. Only meaningful when justLanded is true. */
  landingDescentSpeedMps: number;
  /** A tunable 0..1 metric derived from landingDescentSpeedMps, for Milestone 4's VFX/camera (dust/sparks/shockwave/camera shake) to scale by. Only meaningful when justLanded is true. */
  landingIntensity: number;
  /** How long (seconds) the variable-jump height assist applied during the airborne period that just ended; 0 if this wasn't a jump (e.g. a knockback fall) or was a bare tap. Only meaningful when justLanded is true. */
  landingJumpAssistElapsedS: number;
}

export class DriftController {
  private state = DriftState.Idle;
  private hopTimerS = 0;
  private recoveryTimerS = 0;
  private jumpAssistElapsedS = 0;
  private wasGrounded = true;
  private lastAirborneVerticalVelocityMps = 0;
  /** A turn away from the hop's reference happened during this X press: the drift starts on (or after) landing. */
  private driftArmed = false;
  /** Vertical speed just before the hop's impulse (the floor-following base the jump assist rises from). */
  private hopBaseVerticalMps = 0;
  /** X has been held continuously since this hop began. */
  private holdingSinceHop = false;
  /** Unit direction latched when X was pressed (motion, or held direction / heading at rest). */
  private hopReference = { x: 0, z: 1 };
  /** Seconds airborne in the current drift (a landing bounce or a bump must not end it). */
  private driftAirborneS = 0;
  /** Horizontal velocity on the last airborne tick (the hop's landing keeps it — see below). */
  private lastAirborneHorizontal = { x: 0, z: 0 };

  /**
   * normalLateralGripPerS: the grip Recovering eases back toward — must be
   * this Bey's own BeyHandlingProfile.lateralGripPerS (Milestone 6: grip
   * differs per archetype), not the global MovementTuning default, or the
   * recovery ends at the wrong value and grip snaps the moment the
   * override is released.
   */
  constructor(private readonly normalLateralGripPerS: number = LATERAL_GRIP_PER_S) {}

  /** Current state without advancing anything — for read-only consumers (e.g. a frozen post-round snapshot) that must not progress the state machine. */
  getState(): DriftState {
    return this.state;
  }

  /** Read-only jump/drift timers for Debug Lab inspection (GDD section 69). No gameplay code may branch on this. */
  getDebugTimers(): { hopTimerS: number; recoveryTimerS: number; jumpAssistElapsedS: number; jumpVerticalSpeedAddedMps: number; driftArmed: boolean } {
    return {
      driftArmed: this.driftArmed,
      hopTimerS: this.hopTimerS,
      recoveryTimerS: this.recoveryTimerS,
      jumpAssistElapsedS: this.jumpAssistElapsedS,
      jumpVerticalSpeedAddedMps: this.state === DriftState.Hopping ? HOP_IMPULSE_MPS + JUMP_ASSIST_ACCEL_MPS2 * this.jumpAssistElapsedS : 0,
    };
  }

  /** `headingRad` (the Bey's current heading) is only read for directional-control frames (ControllerActions.moveIntent). */
  tick(body: RAPIER.RigidBody, actions: ControllerActions, grounded: boolean, fixedDeltaSeconds: number, headingRad = 0): DriftTickResult {
    const jumpDriftHeld = actions.held.has(Action.JumpDrift);
    const jumpDriftPressed = actions.pressedThisFrame.has(Action.JumpDrift);
    // The approved control is tap X (a small hop), keep holding X, turn
    // (GDD 19); holding X without turning is the variable jump (GDD 20).
    // A turn is measured against the direction latched when X was pressed
    // (the Bey's motion then, or the held direction / heading at rest) —
    // not the current heading, which in directional control lines up with
    // the held direction within a few ticks. Once turned, the drift is armed
    // for the rest of this X press.
    if (!jumpDriftHeld) {
      this.holdingSinceHop = false;
      this.driftArmed = false;
    } else if (this.holdingSinceHop && this.turnsAwayFromReference(actions)) {
      this.driftArmed = true;
    }

    if (!grounded) {
      const v = body.linvel();
      this.lastAirborneHorizontal = { x: v.x, z: v.z };
      // Keep sampling this every tick while airborne so the last value
      // recorded (read the tick before landing is detected) is the closest
      // available proxy for actual pre-impact descent speed.
      this.lastAirborneVerticalVelocityMps = body.linvel().y;
    }

    let justLanded = false;
    let landingDescentSpeedMps = 0;
    let landingIntensity = 0;
    let landingJumpAssistElapsedS = 0;

    if (this.wasGrounded && !grounded) {
      // Leaving the ground for any reason starts a fresh airborne period
      // with no jump-height assist accrued yet — beginHop() below only
      // adds to it if this period turns out to actually be a jump.
      this.jumpAssistElapsedS = 0;
    } else if (!this.wasGrounded && grounded) {
      justLanded = true;
      landingDescentSpeedMps = Math.max(0, -this.lastAirborneVerticalVelocityMps);
      landingIntensity = Math.min(1, landingDescentSpeedMps / LANDING_INTENSITY_REFERENCE_DESCENT_SPEED_MPS);
      landingJumpAssistElapsedS = this.jumpAssistElapsedS;
    }
    this.wasGrounded = grounded;

    switch (this.state) {
      case DriftState.Idle:
        if (jumpDriftPressed && grounded) {
          this.beginHop(body, actions, headingRad);
        } else if (this.driftArmed && grounded) {
          // Landed from the hop still holding X and turned since: drift.
          this.state = DriftState.Drifting;
          this.driftAirborneS = 0;
        }
        break;

      case DriftState.Hopping: {
        this.hopTimerS += fixedDeltaSeconds;

        // Variable jump height (Milestone 3): holding X without turning
        // keeps adding lift, up to a cap — also while moving. A turn arms
        // the drift instead and stops the lift, so the drift hop stays
        // small and consistent. Never applies once falling (vel.y <= 0) —
        // this is height assist, not a hover.
        if (jumpDriftHeld && !this.driftArmed && this.jumpAssistElapsedS < JUMP_ASSIST_MAX_DURATION_S) {
          // "Rising" is measured against the vertical speed the Bey had
          // when it hopped: going down a bowl's slope it already falls with
          // the floor (vy −2.9 m/s measured on Bowl B), so an absolute
          // vy > 0 test never allowed the variable jump there. On the flat
          // floor the base is 0, as before.
          const vel = body.linvel();
          if (vel.y > this.hopBaseVerticalMps) {
            body.setLinvel({ x: vel.x, y: vel.y + JUMP_ASSIST_ACCEL_MPS2 * fixedDeltaSeconds, z: vel.z }, true);
            this.jumpAssistElapsedS += fixedDeltaSeconds;
          }
        }

        if (this.hopTimerS >= HOP_MIN_AIRBORNE_DURATION_S && grounded) {
          // Landed with JumpDrift still held: drift at once if a turn armed
          // it; otherwise a turn later in this same X press still does.
          // The drift keeps the hop's momentum: the landing contact's
          // friction took ~35% of the horizontal speed in one step (6.4 →
          // 4.1 m/s measured), which read as the Bey stopping, not sliding.
          if (jumpDriftHeld) {
            const v = body.linvel();
            body.setLinvel({ x: this.lastAirborneHorizontal.x, y: v.y, z: this.lastAirborneHorizontal.z }, true);
          }
          this.state = jumpDriftHeld && this.driftArmed ? DriftState.Drifting : DriftState.Idle;
          this.driftAirborneS = 0;
        }
        break;
      }

      case DriftState.Drifting:
        // The drift lasts as long as JumpDrift is held (owner playtest,
        // after M11). It used to end the moment the Bey stopped "steering"
        // (in directional control, once the heading reached the wanted
        // direction — a few ticks) or left the ground at all (the Motion
        // Lab landing bounce lifts it right after touchdown), so a drift
        // measured 4 ticks. A real launch (airborne past the grace) still
        // ends it.
        this.driftAirborneS = grounded ? 0 : this.driftAirborneS + fixedDeltaSeconds;
        if (!jumpDriftHeld || this.driftAirborneS > DRIFT_AIRBORNE_GRACE_S) {
          this.state = DriftState.Recovering;
          this.recoveryTimerS = 0;
        }
        break;

      case DriftState.Recovering:
        this.recoveryTimerS += fixedDeltaSeconds;
        if (jumpDriftPressed && grounded) {
          // Chaining into a fresh drift is allowed mid-recovery.
          this.beginHop(body, actions, headingRad);
        } else if (this.recoveryTimerS >= DRIFT_GRIP_RECOVERY_DURATION_S) {
          this.state = DriftState.Idle;
        }
        break;
    }

    return {
      lateralGripOverridePerS: this.computeLateralGripOverride(),
      driftState: this.state,
      justLanded,
      landingDescentSpeedMps,
      landingIntensity,
      landingJumpAssistElapsedS,
    };
  }

  /**
   * Whether the controls ask to turn away from the hop's latched direction:
   * a turn key (classic), or a held direction more than the directional
   * steering threshold off it (the same threshold that counts as steering).
   */
  private turnsAwayFromReference(actions: ControllerActions): boolean {
    const intent = actions.moveIntent;
    if (!intent) return actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight);
    const m = Math.hypot(intent.x, intent.z);
    if (m === 0) return false;
    const cos = (intent.x * this.hopReference.x + intent.z * this.hopReference.z) / m;
    return Math.acos(Math.max(-1, Math.min(1, cos))) > DIRECTIONAL_STEERING_THRESHOLD_RAD;
  }

  private beginHop(body: RAPIER.RigidBody, actions: ControllerActions, headingRad: number): void {
    this.state = DriftState.Hopping;
    this.driftArmed = false;
    this.holdingSinceHop = true;
    // The reference a turn is measured against: where the Bey is going, or
    // at rest where the player points it (the held direction, else the heading).
    const v = body.linvel();
    const speed = Math.hypot(v.x, v.z);
    const intent = actions.moveIntent;
    const intentLength = intent ? Math.hypot(intent.x, intent.z) : 0;
    if (speed >= DRIFT_REFERENCE_MIN_SPEED_MPS) this.hopReference = { x: v.x / speed, z: v.z / speed };
    else if (intent && intentLength > 0) this.hopReference = { x: intent.x / intentLength, z: intent.z / intentLength };
    else this.hopReference = { x: Math.sin(headingRad), z: Math.cos(headingRad) };
    this.hopTimerS = 0;
    this.jumpAssistElapsedS = 0;
    const vel = body.linvel();
    this.hopBaseVerticalMps = vel.y;
    body.setLinvel({ x: vel.x, y: vel.y + HOP_IMPULSE_MPS, z: vel.z }, true);
  }

  private computeLateralGripOverride(): number | null {
    if (this.state === DriftState.Drifting) {
      return DRIFT_LATERAL_GRIP_PER_S;
    }
    if (this.state === DriftState.Recovering) {
      const t = Math.min(1, this.recoveryTimerS / DRIFT_GRIP_RECOVERY_DURATION_S);
      return DRIFT_LATERAL_GRIP_PER_S + (this.normalLateralGripPerS - DRIFT_LATERAL_GRIP_PER_S) * t;
    }
    return null;
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
  getDeterministicState(): CanonicalRecord {
    return {
      state: this.state,
      hopTimerS: this.hopTimerS,
      recoveryTimerS: this.recoveryTimerS,
      jumpAssistElapsedS: this.jumpAssistElapsedS,
      wasGrounded: this.wasGrounded,
      lastAirborneVerticalVelocityMps: this.lastAirborneVerticalVelocityMps,
      driftArmed: this.driftArmed,
      holdingSinceHop: this.holdingSinceHop,
      hopBaseVerticalMps: this.hopBaseVerticalMps,
      hopReference: { x: this.hopReference.x, z: this.hopReference.z },
      driftAirborneS: this.driftAirborneS,
      lastAirborneHorizontal: { x: this.lastAirborneHorizontal.x, z: this.lastAirborneHorizontal.z },
    };
  }
}
