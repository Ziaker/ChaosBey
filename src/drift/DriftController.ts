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
import { GRAVITY_MPS2 } from '../physics/world/PhysicsWorld';
import {
  DRIFT_AIRBORNE_GRACE_S,
  DRIFT_HOP_TARGET_APEX_M,
  DRIFT_REFERENCE_MIN_SPEED_MPS,
  DRIFT_GRIP_RECOVERY_DURATION_S,
  DRIFT_LATERAL_GRIP_PER_S,
  HOP_MIN_AIRBORNE_DURATION_S,
  JUMP_INPUT_BUFFER_WINDOW_S,
  JUMP_LAUNCH_VELOCITY_MPS,
  JUMP_RELEASE_WINDOW_S,
  JUMP_SHORT_HOP_TARGET_APEX_M,
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
  /** Seconds JumpDrift has been continuously held since this hop's single launch impulse — used only to look up where on the release-cut curve a release (or a drift arming) currently falls. Stops advancing, and stops mattering, once jumpCutApplied is true. */
  private jumpAssistElapsedS = 0;
  /** The one-time release cut (short/medium/full height, or the drift-hop profile) has already been applied for this hop — or there was nothing left to cut (already past its own apex). At most one per hop, by construction (see DriftTuning.ts's header comment). */
  private jumpCutApplied = false;
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
   * Jump input buffer (hotfix — see DriftTuning.ts's JUMP_INPUT_BUFFER_WINDOW_S
   * for why this exists and isn't coyote time): seconds since a JumpDrift
   * press arrived in Idle/Recovering while grounded was transiently false;
   * null = no press pending. Consumed exactly once (cancelBufferedJump,
   * called from beginHop) the instant grounded becomes true, same as a
   * same-tick press would be. Ages every tick and is dropped once older
   * than the window (no ghost hop long after the original press), and is
   * explicitly cancelled on window blur/focus loss (see cancelBufferedJump
   * and KeyboardController.handleWindowBlur, GDD 131) so a stale press
   * can never survive a disruption that already forgets every held key.
   */
  private bufferedJumpElapsedS: number | null = null;

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

  /** Read-only jump/drift timers for Debug Lab inspection (GDD section 69). No gameplay code may branch on this. `body` is only read for the live vertical-speed-added readout (there is no per-tick assist to reconstruct from internal state alone any more — see DriftTuning.ts). */
  getDebugTimers(body: RAPIER.RigidBody): { hopTimerS: number; recoveryTimerS: number; jumpAssistElapsedS: number; jumpVerticalSpeedAddedMps: number; driftArmed: boolean } {
    const addedNow = this.state === DriftState.Hopping ? body.linvel().y - this.hopBaseVerticalMps : 0;
    return {
      driftArmed: this.driftArmed,
      hopTimerS: this.hopTimerS,
      recoveryTimerS: this.recoveryTimerS,
      jumpAssistElapsedS: this.jumpAssistElapsedS,
      jumpVerticalSpeedAddedMps: Math.max(0, addedNow),
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

    // Jump input buffer: age/expire a pending press before this tick's
    // Idle/Recovering case looks at it (see bufferedJumpElapsedS's own
    // comment and DriftTuning.ts's JUMP_INPUT_BUFFER_WINDOW_S).
    if (this.bufferedJumpElapsedS !== null) {
      this.bufferedJumpElapsedS += fixedDeltaSeconds;
      if (this.bufferedJumpElapsedS > JUMP_INPUT_BUFFER_WINDOW_S) {
        this.bufferedJumpElapsedS = null;
      }
    }

    switch (this.state) {
      case DriftState.Idle:
        if (grounded && (jumpDriftPressed || this.bufferedJumpElapsedS !== null)) {
          this.beginHop(body, actions, headingRad);
        } else if (jumpDriftPressed && !grounded) {
          // Can't begin the hop this tick (transiently airborne — a bounce,
          // a knockback settling, the ground check a tick or two late) —
          // buffer the press instead of dropping it; beginHop() above
          // consumes it the instant grounded is true again.
          this.bufferedJumpElapsedS = 0;
        } else if (this.driftArmed && grounded) {
          // Landed from the hop still holding X and turned since: drift.
          this.state = DriftState.Drifting;
          this.driftAirborneS = 0;
        }
        break;

      case DriftState.Hopping: {
        this.hopTimerS += fixedDeltaSeconds;

        // Variable jump height: a single launch impulse was already applied
        // in beginHop(); from here, vy only ever decreases (gravity, same as
        // any free fall — nothing adds to it per tick any more). The ONLY
        // thing this state still does to vy is apply, at most once, the
        // release cut that actually shapes short/medium/full height, the
        // instant one of three things happens while still rising: a drift
        // arms (drift's own small, fixed profile), JumpDrift is released (the
        // hold-duration-shaped cut), or the release window elapses while
        // still held (nothing to cut — already committed to the full arc).
        // "Rising" is measured against the vertical speed the Bey had when
        // it hopped: going down a bowl's slope it already falls with the
        // floor (vy −2.9 m/s measured on Bowl B), so an absolute vy > 0 test
        // never allowed the variable jump there. On the flat floor the base
        // is 0, as before.
        if (!this.jumpCutApplied) {
          const vel = body.linvel();
          if (vel.y > this.hopBaseVerticalMps) {
            if (this.driftArmed) {
              const target = this.hopBaseVerticalMps + this.computeDriftHopCutMps(this.jumpAssistElapsedS);
              if (vel.y > target) body.setLinvel({ x: vel.x, y: target, z: vel.z }, true);
              this.jumpCutApplied = true;
            } else if (!jumpDriftHeld) {
              const target = this.hopBaseVerticalMps + this.computeJumpReleaseCapMps(this.jumpAssistElapsedS);
              if (vel.y > target) body.setLinvel({ x: vel.x, y: target, z: vel.z }, true);
              this.jumpCutApplied = true;
            } else if (this.jumpAssistElapsedS >= JUMP_RELEASE_WINDOW_S) {
              // Held through the whole release window: already committed to
              // the full, uncut arc — there is nothing left to cut, ever,
              // for the rest of this hop (holding longer changes nothing).
              this.jumpCutApplied = true;
            } else {
              this.jumpAssistElapsedS += fixedDeltaSeconds;
            }
          } else {
            // Already past this hop's own apex (or never really rising at
            // all, off a downslope) — too late for a release cut to mean
            // anything.
            this.jumpCutApplied = true;
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
        if (grounded && (jumpDriftPressed || this.bufferedJumpElapsedS !== null)) {
          // Chaining into a fresh drift is allowed mid-recovery.
          this.beginHop(body, actions, headingRad);
        } else if (jumpDriftPressed && !grounded) {
          // Same airborne-press buffering as Idle (see that case's comment).
          this.bufferedJumpElapsedS = 0;
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

  /**
   * Cancels a buffered jump press, if any. Call on window blur/focus loss
   * (KeyboardController.handleWindowBlur, GDD 131) — the same disruption
   * that already forgets every held/pending key must also forget a press
   * this controller is still privately holding onto, or a stale press from
   * before the disruption could fire a ghost hop after it. A no-op when
   * nothing is buffered.
   */
  cancelBufferedJump(): void {
    this.bufferedJumpElapsedS = null;
  }

  private beginHop(body: RAPIER.RigidBody, actions: ControllerActions, headingRad: number): void {
    this.bufferedJumpElapsedS = null;
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
    this.jumpCutApplied = false;
    const vel = body.linvel();
    this.hopBaseVerticalMps = vel.y;
    // The entire vertical launch, applied once, immediately (no waiting to
    // see how long the press lasts — GDD section 13 of the jump/air-control
    // hotfix). Every other height (short/medium, or the drift hop) comes
    // from cutting THIS SAME arc short later, in the Hopping state above —
    // never from a second application of force.
    body.setLinvel({ x: vel.x, y: vel.y + JUMP_LAUNCH_VELOCITY_MPS, z: vel.z }, true);
  }

  /**
   * The natural (uncut) apex JUMP_LAUNCH_VELOCITY_MPS alone would reach
   * under constant gravity — the energy-conservation identity
   * height(t) + vy(t)^2/(2*GRAVITY_MPS2) = this, for every t along the
   * uncut arc, is what makes computeJumpReleaseCapMps below exact at both
   * of its ends.
   */
  private get naturalFullApexM(): number {
    return (JUMP_LAUNCH_VELOCITY_MPS * JUMP_LAUNCH_VELOCITY_MPS) / (2 * GRAVITY_MPS2);
  }

  /**
   * The hold-time at which the arc's own natural (uncut) height first
   * reaches JUMP_SHORT_HOP_TARGET_APEX_M — the root of
   * JUMP_LAUNCH_VELOCITY_MPS*t - 0.5*GRAVITY_MPS2*t^2 = target (the
   * smaller of the quadratic's two roots). Below this, the release cut
   * hits the short-hop target exactly, by construction (see
   * computeJumpReleaseCapMps); this is the width of that exact window, and
   * it is set entirely by JUMP_LAUNCH_VELOCITY_MPS and the target height —
   * for small t, height ~= V0*t regardless of what happens to vy
   * afterward, so no shape of release cut can widen it without either
   * lowering V0 (shrinking the full jump below its approved 1.0-1.5 m
   * floor) or raising the target (no longer a "short" hop). Jump/air-control
   * hotfix follow-up (owner review): this replaces a first version whose
   * release cut was only exact for a single tick.
   */
  private get shortHopExactWindowS(): number {
    const v0 = JUMP_LAUNCH_VELOCITY_MPS;
    const g = GRAVITY_MPS2;
    const discriminant = v0 * v0 - 2 * g * JUMP_SHORT_HOP_TARGET_APEX_M;
    return (v0 - Math.sqrt(Math.max(0, discriminant))) / g;
  }

  /**
   * The release-cut target, in added-velocity terms (relative to
   * hopBaseVerticalMps — see DriftTuning.ts's header comment for why this
   * decomposition is exact under constant gravity). Two regimes, joined
   * continuously at shortHopExactWindowS:
   * - holdElapsedS <= shortHopExactWindowS: cuts to hit
   *   JUMP_SHORT_HOP_TARGET_APEX_M exactly — "height already gained under
   *   the uncut arc, plus the remaining rise from the cut velocity, equals
   *   the target" (same technique as computeDriftHopCutMps), which is
   *   always solvable with a non-negative cut velocity in this regime by
   *   definition of shortHopExactWindowS.
   * - holdElapsedS > shortHopExactWindowS (up to JUMP_RELEASE_WINDOW_S):
   *   the target apex itself ramps LINEARLY from the short-hop target up
   *   to naturalFullApexM, reaching naturalFullApexM exactly at
   *   JUMP_RELEASE_WINDOW_S — by the energy-conservation identity, the cut
   *   velocity this produces at JUMP_RELEASE_WINDOW_S exactly equals the
   *   arc's own natural vy there, so this joins continuously with "already
   *   committed, nothing left to cut" past the window, with no step.
   * Every value this returns is <= the natural decay curve
   * (JUMP_LAUNCH_VELOCITY_MPS - GRAVITY_MPS2 * holdElapsedS) at that same
   * holdElapsedS (both regimes solve "height so far + remaining rise =
   * some target <= naturalFullApexM", which can only ever require a cut
   * velocity at or below the natural one), so applying this via
   * `vy = min(vy, hopBase + this)` can only ever cut the arc short, never
   * add to it — "no positive vy reacceleration after launch" and "exactly
   * one apex" by construction, not by a separate safety check.
   */
  private computeJumpReleaseCapMps(holdElapsedS: number): number {
    const t = Math.min(holdElapsedS, JUMP_RELEASE_WINDOW_S);
    const exactWindowS = this.shortHopExactWindowS;
    const heightAlreadyGainedM = JUMP_LAUNCH_VELOCITY_MPS * t - 0.5 * GRAVITY_MPS2 * t * t;
    let targetApexM: number;
    if (t <= exactWindowS) {
      targetApexM = JUMP_SHORT_HOP_TARGET_APEX_M;
    } else {
      const naturalFullApexM = this.naturalFullApexM;
      const frac = (t - exactWindowS) / (JUMP_RELEASE_WINDOW_S - exactWindowS);
      targetApexM = JUMP_SHORT_HOP_TARGET_APEX_M + (naturalFullApexM - JUMP_SHORT_HOP_TARGET_APEX_M) * frac;
    }
    const remainingM = Math.max(0, targetApexM - heightAlreadyGainedM);
    return Math.sqrt(2 * GRAVITY_MPS2 * remainingM);
  }

  /**
   * The drift-hop's own release-cut target, in added-velocity terms
   * (relative to hopBaseVerticalMps, same decomposition as above): unlike
   * the variable-jump cut, this one targets a fixed APEX HEIGHT
   * (DRIFT_HOP_TARGET_APEX_M) rather than a fixed velocity, because a turn
   * can arm the drift at any point in the press — a fixed-velocity cut
   * would still leave a taller hop the later the turn happens (the height
   * already gained while rising at the full, uncut launch velocity before
   * the cut can apply is structurally un-cuttable by any velocity-only
   * correction — the same effect the hold-duration sweep documents for
   * short-hop quick-tap variance). Solving "height already gained at
   * holdElapsedS, under the known uncut launch arc, plus the remaining rise
   * from the cut velocity, equals the target apex" for the cut velocity
   * gets the closest a one-time, no-position-snap, no-second-event
   * reduction can get to a timing-independent drift hop: exact while the
   * turn comes early enough that height-already-gained hasn't yet reached
   * the target (see the hold-duration sweep for exactly how late "early
   * enough" is), and "stop rising immediately" — never "keep rising" — once
   * it hasn't.
   */
  private computeDriftHopCutMps(holdElapsedS: number): number {
    const t = Math.min(holdElapsedS, JUMP_RELEASE_WINDOW_S);
    const heightAlreadyGainedM = JUMP_LAUNCH_VELOCITY_MPS * t - 0.5 * GRAVITY_MPS2 * t * t;
    const remainingM = Math.max(0, DRIFT_HOP_TARGET_APEX_M - heightAlreadyGainedM);
    return Math.sqrt(2 * GRAVITY_MPS2 * remainingM);
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
      jumpCutApplied: this.jumpCutApplied,
      wasGrounded: this.wasGrounded,
      lastAirborneVerticalVelocityMps: this.lastAirborneVerticalVelocityMps,
      driftArmed: this.driftArmed,
      holdingSinceHop: this.holdingSinceHop,
      hopBaseVerticalMps: this.hopBaseVerticalMps,
      hopReference: { x: this.hopReference.x, z: this.hopReference.z },
      driftAirborneS: this.driftAirborneS,
      lastAirborneHorizontal: { x: this.lastAirborneHorizontal.x, z: this.lastAirborneHorizontal.z },
      bufferedJumpElapsedS: this.bufferedJumpElapsedS,
    };
  }
}
