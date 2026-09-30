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
// by steering (GDD section 19 vs. 20): holding X *without* steering keeps
// adding height (variable jump); the moment steering is held, that signals
// drift intent — height assist stops immediately and the hop stays at its
// small Milestone 1 liftoff, so a drift-into slide never accidentally
// becomes a tall jump.
//
// Landing is detected generically, independent of DriftState: any
// grounded<-airborne transition (a hop, a knockback launch, falling off a
// ledge) reports justLanded plus descent speed/intensity/jump-assist data
// for Milestone 4's VFX/camera to react to — it never gates on being in
// the Hopping state, and carries no handling penalty of its own.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import { Action, type ControllerActions } from '../input/actions/Action';
import { LATERAL_GRIP_PER_S } from '../bey/movement/MovementTuning';
import { isSteering } from '../bey/movement/directionalIntent';
import {
  DRIFT_AIRBORNE_GRACE_S,
  DRIFT_ENTRY_MIN_SPEED_MPS,
  DRIFT_ENTRY_SLIP_RAD,
  DRIFT_HOP_INTENT_MIN_SPEED_MPS,
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
  /** The hop landed with JumpDrift still held and no turn yet: the first turn while it stays held starts the drift. */
  private driftArmed = false;
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
    // The approved control is hop, then hold JumpDrift *while steering* to
    // slide (GDD section 19) — holding JumpDrift straight must not drift.
    // Drift intent is a turn: the stick/keys asking for a new direction, or
    // — since the heading turns in the air while the velocity does not —
    // a heading already away from where the Bey is actually going.
    const steering = isSteering(actions, headingRad) || this.headingOffVelocity(body, headingRad);

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
        if (!jumpDriftHeld) this.driftArmed = false;
        if (jumpDriftPressed && grounded) {
          this.beginHop(body);
        } else if (this.driftArmed && grounded && steering) {
          this.driftArmed = false;
          this.state = DriftState.Drifting;
          this.driftAirborneS = 0;
        }
        break;

      case DriftState.Hopping: {
        this.hopTimerS += fixedDeltaSeconds;

        // Variable jump height (Milestone 3): held *without* steering keeps
        // adding lift, up to a cap. Steering signals drift intent instead —
        // stop adding height so the drift hop stays small and consistent.
        // Never applies once falling (vel.y <= 0) — this is height assist,
        // not a hover.
        // Owner playtest (after M11): GDD 19's drift is "tap X, keep
        // holding X, turn" — but holding also meant the variable jump
        // (GDD 20) unless the Bey was already turning, and in directional
        // control the heading lines up with the held direction within a
        // few ticks, so almost every drift attempt became a 1.3 s, 1.7 m
        // jump. Moving at speed with a direction held, the hold is drift
        // intent: the hop stays small. From rest, or with no direction
        // held, holding X still jumps higher.
        const driftIntentByMotion = this.hasMoveInput(actions) && Math.hypot(body.linvel().x, body.linvel().z) >= DRIFT_HOP_INTENT_MIN_SPEED_MPS;
        if (jumpDriftHeld && !steering && !driftIntentByMotion && this.jumpAssistElapsedS < JUMP_ASSIST_MAX_DURATION_S) {
          const vel = body.linvel();
          if (vel.y > 0) {
            body.setLinvel({ x: vel.x, y: vel.y + JUMP_ASSIST_ACCEL_MPS2 * fixedDeltaSeconds, z: vel.z }, true);
            this.jumpAssistElapsedS += fixedDeltaSeconds;
          }
        }

        if (this.hopTimerS >= HOP_MIN_AIRBORNE_DURATION_S && grounded) {
          // Landed with JumpDrift still held: drift at once if turning,
          // otherwise armed — the first turn while it stays held starts it.
          // The drift keeps the hop's momentum: the landing contact's
          // friction took ~35% of the horizontal speed in one step (6.4 →
          // 4.1 m/s measured), which read as the Bey stopping, not sliding.
          if (jumpDriftHeld) {
            const v = body.linvel();
            body.setLinvel({ x: this.lastAirborneHorizontal.x, y: v.y, z: this.lastAirborneHorizontal.z }, true);
          }
          this.driftArmed = jumpDriftHeld && !steering;
          this.state = jumpDriftHeld && steering ? DriftState.Drifting : DriftState.Idle;
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
          this.beginHop(body);
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

  private hasMoveInput(actions: ControllerActions): boolean {
    const intent = actions.moveIntent;
    if (intent) return Math.hypot(intent.x, intent.z) > 0;
    return actions.held.has(Action.MoveForward) || actions.held.has(Action.MoveBackward) || actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight);
  }

  private headingOffVelocity(body: RAPIER.RigidBody, headingRad: number): boolean {
    const v = body.linvel();
    if (Math.hypot(v.x, v.z) < DRIFT_ENTRY_MIN_SPEED_MPS) return false;
    const off = Math.atan2(Math.sin(Math.atan2(v.x, v.z) - headingRad), Math.cos(Math.atan2(v.x, v.z) - headingRad));
    return Math.abs(off) > DRIFT_ENTRY_SLIP_RAD;
  }

  private beginHop(body: RAPIER.RigidBody): void {
    this.state = DriftState.Hopping;
    this.driftArmed = false;
    this.hopTimerS = 0;
    this.jumpAssistElapsedS = 0;
    const vel = body.linvel();
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
      driftAirborneS: this.driftAirborneS,
      lastAirborneHorizontal: { x: this.lastAirborneHorizontal.x, z: this.lastAirborneHorizontal.z },
    };
  }
}
