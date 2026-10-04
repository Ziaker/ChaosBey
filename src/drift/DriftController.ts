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
// Owner, 2026-10-02 (Lote 4) — the drift rule, with no hidden angle: X held
// together with a lateral direction (left/right, or a diagonal — the
// SteerLeft/SteerRight input, which directional control also keeps) while
// the Bey is moving (at least DRIFT_REFERENCE_MIN_SPEED_MPS when X was
// pressed) arms the drift; X without a lateral direction, or from a
// standstill, is a jump.
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
import { GRAVITY_MPS2 } from '../physics/world/PhysicsWorld';
import { FIXED_DELTA_SECONDS as FIXED_STEP_S } from '../physics/fixed-step/FixedTimestepLoop';
import {
  DRIFT_AIRBORNE_GRACE_S,
  DRIFT_HOP_TARGET_APEX_M,
  DRIFT_REFERENCE_MIN_SPEED_MPS,
  DRIFT_GRIP_RECOVERY_DURATION_S,
  DRIFT_LATERAL_GRIP_PER_S,
  HOP_MIN_AIRBORNE_DURATION_S,
  JUMP_INPUT_BUFFER_WINDOW_S,
  LEGACY_JUMP_FULL_HEIGHT_M,
  jumpLaunchVelocityForApexM,
  JUMP_RELEASE_WINDOW_S,
  JUMP_SHORT_HOP_TARGET_APEX_M,
  JUMP_HOLD_FOR_FULL_DEFAULT_S,
  DRIFT_FOLLOW_UP_WINDOW_S,
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
  /** Lote 9: a hop/jump began this tick (its Stamina cost is charged by the caller). */
  hopBegan: boolean;
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
  /** The Bey was moving (>= DRIFT_REFERENCE_MIN_SPEED_MPS) when X was pressed: only then can the press become a drift. */
  private movingAtHop = false;
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
  /** Launch speed of this match's full jump (√(2·g·fullHeight)) and its short-hop apex (owner, 2026-10-02). */
  private readonly launchMps: number;
  private readonly shortHopApexM: number;
  /**
   * Owner audit B6 (2026-10-03): the Full jump slider must not change the short hop or the drift hop. With the full
   * impulse applied on the press tick, the first tick of flight at the full launch speed already rose 0.12 m at 2.5 m
   * (0.17 m at 5 m) — more than the short/drift hop's whole target (0.127 m) — before any cut could act. Now a press
   * decides its one launch on the tick after it (16.7 ms), from what the input says by then: released = a short hop,
   * X + a lateral direction while moving = a drift hop, still held = the full jump (cut on release). A drift hop
   * whose lateral is already held on the press tick launches at once. Still one impulse, one flight, no
   * re-acceleration. Matches built without jump rules (bare constructions, the Camera Lab) keep the old immediate
   * full launch.
   */
  private readonly legacyLaunch: boolean;
  /** B6: a press began the hop; its single launch is decided this tick. */
  private launchPending = false;
  /** Owner, 2026-10-04: the current/last hop was the short hop (its follow-up X press is the drift). */
  private lastHopShort = false;
  /** Seconds left, after a short hop landed, in which an X press is the drift instead of a new jump (null = none). */
  private driftFollowUpS: number | null = null;
  /** B6: the body's height at launch and fixed steps since, for the release cut's height-already-gained (measured, not assumed). */
  private launchY = 0;
  private stepsSinceLaunch = 0;
  /** Lote 9 (GDD 12): MatchConfig.jumpCooldownS — after a hop begins, the next can't begin for this long (a press meanwhile is kept, as in the air). */
  private readonly jumpCooldownS: number;
  /** Owner, 2026-10-04: X still held this long after the press turns the short hop into the full jump (MatchConfig.jumpHoldForFullS). */
  private readonly jumpHoldForFullS: number;
  private jumpCooldownRemainingS = 0;
  private hopBeganThisTick = false;
  /** Lote 9: whether a hop may begin this tick (the caller's Stamina check for the jump's cost). */
  private jumpAllowed = true;

  constructor(
    private readonly normalLateralGripPerS: number = LATERAL_GRIP_PER_S,
    /** The match's jump heights (MatchConfig). Omitted = the pre-2026-10-02 jump (LEGACY_JUMP_FULL_HEIGHT_M). */
    jumpRules?: { readonly jumpFullHeightM: number; readonly jumpShortHopHeightM: number; readonly jumpCooldownS?: number; readonly jumpHoldForFullS?: number },
  ) {
    this.jumpCooldownS = Math.max(0, jumpRules?.jumpCooldownS ?? 0);
    this.jumpHoldForFullS = Math.max(0, jumpRules?.jumpHoldForFullS ?? JUMP_HOLD_FOR_FULL_DEFAULT_S);
    this.legacyLaunch = jumpRules === undefined;
    const jump = jumpRules ?? { jumpFullHeightM: LEGACY_JUMP_FULL_HEIGHT_M, jumpShortHopHeightM: JUMP_SHORT_HOP_TARGET_APEX_M };
    this.launchMps = jumpLaunchVelocityForApexM(jump.jumpFullHeightM);
    // A short hop can never be taller than the full jump.
    this.shortHopApexM = Math.min(jump.jumpShortHopHeightM, jump.jumpFullHeightM);
  }

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
  tick(body: RAPIER.RigidBody, actions: ControllerActions, grounded: boolean, fixedDeltaSeconds: number, headingRad = 0, jumpAllowed = true): DriftTickResult {
    this.hopBeganThisTick = false;
    this.jumpAllowed = jumpAllowed;
    this.jumpCooldownRemainingS = Math.max(0, this.jumpCooldownRemainingS - fixedDeltaSeconds);
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
    } else if (this.legacyLaunch && this.holdingSinceHop && this.movingAtHop && this.lateralHeld(actions)) {
      this.driftArmed = true;
    }
    // Owner, 2026-10-04: "dar um toque + segurar, MESMO SE CAIR NO CHÃO = drift" — and never another jump. A second
    // X press after a short hop (still in the air, or within DRIFT_FOLLOW_UP_WINDOW_S of landing) is the drift: held,
    // the Bey drifts (on landing, or at once if already down). It is not buffered as a jump.
    const driftFollowUp =
      !this.legacyLaunch &&
      jumpDriftPressed &&
      ((this.state === DriftState.Hopping && !this.launchPending && this.lastHopShort) || (this.state === DriftState.Idle && this.driftFollowUpS !== null));
    if (driftFollowUp) {
      this.driftArmed = true;
      this.bufferedJumpElapsedS = null;
    }
    if (this.driftFollowUpS !== null && this.state === DriftState.Idle && grounded) {
      this.driftFollowUpS -= fixedDeltaSeconds;
      if (this.driftFollowUpS <= 0) this.driftFollowUpS = null;
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
    // Owner, 2026-10-02 (Lote 4; PR #76's pressDroppedWhileAirborne): a press made in the air — in any state, a hop or
    // a drift included — is kept until the Bey lands and consumed there once. It only ages on the ground, so a flight
    // or a landing settle longer than the window no longer throws it away.
    if (jumpDriftPressed && !driftFollowUp && !grounded && (this.state === DriftState.Hopping || this.state === DriftState.Drifting)) {
      this.bufferedJumpElapsedS = 0;
    }
    if (this.bufferedJumpElapsedS !== null && grounded) {
      this.bufferedJumpElapsedS += fixedDeltaSeconds;
      if (this.bufferedJumpElapsedS > JUMP_INPUT_BUFFER_WINDOW_S) {
        this.bufferedJumpElapsedS = null;
      }
    }

    switch (this.state) {
      case DriftState.Idle:
        if (driftFollowUp) {
          // The follow-up press after a short hop that already landed: drift right away, no new jump.
          this.driftFollowUpS = null;
          this.state = DriftState.Drifting;
          this.driftAirborneS = 0;
        } else if (grounded && (jumpDriftPressed || this.bufferedJumpElapsedS !== null)) {
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
        if (!this.legacyLaunch) {
          // Owner, 2026-10-04: two fixed heights, one arc each, decided only by how long X is held. The Bey leaves the
          // floor once, with the height already decided: X released before jumpHoldForFullS = the short hop (launched
          // on the release); X still held then = the full jump. Steering never changes the height (a turn only makes the
          // landing a drift if X is still held); the exact release instant no longer shapes it either.
          if (this.launchPending) {
            const decided = !jumpDriftHeld ? this.shortHopLaunchMps : null;
            this.jumpAssistElapsedS += fixedDeltaSeconds;
            const launchMps = decided ?? (this.jumpAssistElapsedS >= this.jumpHoldForFullS - 1e-9 ? this.launchMps : null);
            if (launchMps !== null) {
              this.launchPending = false;
              this.hopBaseVerticalMps = body.linvel().y;
              this.hopTimerS = 0;
              const heldS = this.jumpAssistElapsedS;
              this.lastHopShort = launchMps === this.shortHopLaunchMps;
              this.launch(body, launchMps, true);
              this.jumpAssistElapsedS = heldS; // how long X was held before the launch (landing data reads it)
            }
            break;
          }
          this.stepsSinceLaunch++;
          this.hopTimerS += fixedDeltaSeconds;
          if (this.hopTimerS >= HOP_MIN_AIRBORNE_DURATION_S && grounded) this.landHop(body, jumpDriftHeld);
          break;
        }
        this.stepsSinceLaunch++;
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
              const target = this.hopBaseVerticalMps + this.computeDriftHopCutMps(body, this.jumpAssistElapsedS);
              if (vel.y > target) body.setLinvel({ x: vel.x, y: target, z: vel.z }, true);
              this.jumpCutApplied = true;
            } else if (!jumpDriftHeld) {
              const target = this.hopBaseVerticalMps + this.computeJumpReleaseCapMps(body, this.jumpAssistElapsedS);
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
          this.landHop(body, jumpDriftHeld);
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
      hopBegan: this.hopBeganThisTick,
    };
  }

  /** A lateral direction is held: left/right or a diagonal (SteerLeft/SteerRight, in either control scheme). */
  private lateralHeld(actions: ControllerActions): boolean {
    return actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight);
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
    if (this.jumpCooldownRemainingS > 0 || !this.jumpAllowed) {
      // Lote 9: still cooling down (or the jump's Stamina cost can't be paid): keep the press, like an air press.
      this.bufferedJumpElapsedS = 0;
      return;
    }
    this.jumpCooldownRemainingS = this.jumpCooldownS;
    this.hopBeganThisTick = true;
    this.bufferedJumpElapsedS = null;
    this.driftFollowUpS = null;
    this.lastHopShort = false;
    this.state = DriftState.Hopping;
    this.driftArmed = false;
    this.holdingSinceHop = true;
    // The reference a turn is measured against: where the Bey is going, or
    // at rest where the player points it (the held direction, else the heading).
    const v = body.linvel();
    const speed = Math.hypot(v.x, v.z);
    const intent = actions.moveIntent;
    const intentLength = intent ? Math.hypot(intent.x, intent.z) : 0;
    this.movingAtHop = speed >= DRIFT_REFERENCE_MIN_SPEED_MPS;
    if (speed >= DRIFT_REFERENCE_MIN_SPEED_MPS) this.hopReference = { x: v.x / speed, z: v.z / speed };
    else if (intent && intentLength > 0) this.hopReference = { x: intent.x / intentLength, z: intent.z / intentLength };
    else this.hopReference = { x: Math.sin(headingRad), z: Math.cos(headingRad) };
    this.hopTimerS = 0;
    this.jumpAssistElapsedS = 0;
    this.jumpCutApplied = false;
    const vel = body.linvel();
    this.hopBaseVerticalMps = vel.y;
    if (this.legacyLaunch) {
      // The entire vertical launch, applied once, immediately (GDD section 13 of the jump/air-control hotfix); every
      // other height comes from cutting THIS SAME arc short later, in the Hopping state above.
      this.launch(body, this.launchMps, false);
      return;
    }
    // B6: X with a lateral direction while moving is a drift hop from the first tick: launch it now. Anything else
    // launches next tick, once the input shows a tap or a hold.
    // Owner, 2026-10-04: the floor is left once the tap/hold is known (see Hopping). A lateral direction only arms the
    // drift for the landing; it never changes the height.
    if (this.movingAtHop && this.lateralHeld(actions)) this.driftArmed = true;
    this.launchPending = true;
  }

  /** Landed with JumpDrift still held: drift at once if a turn armed it. The drift keeps the hop's horizontal speed. */
  private landHop(body: RAPIER.RigidBody, jumpDriftHeld: boolean): void {
    // A short hop that lands opens the window in which a second X press is the drift, not a new jump.
    if (!this.legacyLaunch && this.lastHopShort && !(jumpDriftHeld && this.driftArmed)) this.driftFollowUpS = DRIFT_FOLLOW_UP_WINDOW_S;
    if (jumpDriftHeld) {
      const v = body.linvel();
      body.setLinvel({ x: this.lastAirborneHorizontal.x, y: v.y, z: this.lastAirborneHorizontal.z }, true);
    }
    this.state = jumpDriftHeld && this.driftArmed ? DriftState.Drifting : DriftState.Idle;
    this.driftAirborneS = 0;
  }

  /** The hop's single vertical impulse: `addedMps` on top of the vertical speed it had (a bowl slope's). `final` = no release cut will follow. */
  private launch(body: RAPIER.RigidBody, addedMps: number, final: boolean): void {
    const vel = body.linvel();
    body.setLinvel({ x: vel.x, y: this.hopBaseVerticalMps + addedMps, z: vel.z }, true);
    this.jumpCutApplied = final;
    this.jumpAssistElapsedS = 0;
    this.stepsSinceLaunch = 0;
    if (!this.legacyLaunch) this.launchY = body.translation().y; // legacy cuts use the analytic arc (and never read it)
  }

  /** Launch speed of a short hop / a drift hop: their own apex, whatever the full jump is (B6). */
  private get shortHopLaunchMps(): number {
    return Math.sqrt(2 * GRAVITY_MPS2 * this.shortHopApexM);
  }

  private get driftHopLaunchMps(): number {
    return Math.sqrt(2 * GRAVITY_MPS2 * DRIFT_HOP_TARGET_APEX_M);
  }

  /** Height the launch has added so far (above the bowl slope's own motion): measured (B6), or the old analytic arc for legacy constructions. */
  private heightAlreadyGainedM(body: RAPIER.RigidBody, holdElapsedS: number): number {
    if (this.legacyLaunch) return this.launchMps * holdElapsedS - 0.5 * GRAVITY_MPS2 * holdElapsedS * holdElapsedS;
    const t = this.stepsSinceLaunch * FIXED_STEP_S;
    return body.translation().y - this.launchY - this.hopBaseVerticalMps * t;
  }

  /**
   * The natural (uncut) apex this.launchMps alone would reach
   * under constant gravity — the energy-conservation identity
   * height(t) + vy(t)^2/(2*GRAVITY_MPS2) = this, for every t along the
   * uncut arc, is what makes computeJumpReleaseCapMps below exact at both
   * of its ends.
   */
  private get naturalFullApexM(): number {
    return (this.launchMps * this.launchMps) / (2 * GRAVITY_MPS2);
  }

  /**
   * The hold-time at which the arc's own natural (uncut) height first
   * reaches this.shortHopApexM — the root of
   * this.launchMps*t - 0.5*GRAVITY_MPS2*t^2 = target (the
   * smaller of the quadratic's two roots). Below this, the release cut
   * hits the short-hop target exactly, by construction (see
   * computeJumpReleaseCapMps); this is the width of that exact window, and
   * it is set entirely by this.launchMps and the target height —
   * for small t, height ~= V0*t regardless of what happens to vy
   * afterward, so no shape of release cut can widen it without either
   * lowering V0 (shrinking the full jump below its approved 1.0-1.5 m
   * floor) or raising the target (no longer a "short" hop). Jump/air-control
   * hotfix follow-up (owner review): this replaces a first version whose
   * release cut was only exact for a single tick.
   */
  private get shortHopExactWindowS(): number {
    const v0 = this.launchMps;
    const g = GRAVITY_MPS2;
    const discriminant = v0 * v0 - 2 * g * this.shortHopApexM;
    return (v0 - Math.sqrt(Math.max(0, discriminant))) / g;
  }

  /**
   * The release-cut target, in added-velocity terms (relative to
   * hopBaseVerticalMps — see DriftTuning.ts's header comment for why this
   * decomposition is exact under constant gravity). Two regimes, joined
   * continuously at shortHopExactWindowS:
   * - holdElapsedS <= shortHopExactWindowS: cuts to hit
   *   this.shortHopApexM exactly — "height already gained under
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
   * (this.launchMps - GRAVITY_MPS2 * holdElapsedS) at that same
   * holdElapsedS (both regimes solve "height so far + remaining rise =
   * some target <= naturalFullApexM", which can only ever require a cut
   * velocity at or below the natural one), so applying this via
   * `vy = min(vy, hopBase + this)` can only ever cut the arc short, never
   * add to it — "no positive vy reacceleration after launch" and "exactly
   * one apex" by construction, not by a separate safety check.
   */
  private computeJumpReleaseCapMps(body: RAPIER.RigidBody, holdElapsedS: number): number {
    const t = Math.min(holdElapsedS, JUMP_RELEASE_WINDOW_S);
    const exactWindowS = this.shortHopExactWindowS;
    const heightAlreadyGainedM = this.heightAlreadyGainedM(body, t);
    let targetApexM: number;
    if (t <= exactWindowS) {
      targetApexM = this.shortHopApexM;
    } else {
      const naturalFullApexM = this.naturalFullApexM;
      const frac = (t - exactWindowS) / (JUMP_RELEASE_WINDOW_S - exactWindowS);
      targetApexM = this.shortHopApexM + (naturalFullApexM - this.shortHopApexM) * frac;
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
  private computeDriftHopCutMps(body: RAPIER.RigidBody, holdElapsedS: number): number {
    const t = Math.min(holdElapsedS, JUMP_RELEASE_WINDOW_S);
    const heightAlreadyGainedM = this.heightAlreadyGainedM(body, t);
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
      jumpCooldownRemainingS: this.jumpCooldownRemainingS,
      launchPending: this.launchPending,
      launchY: this.launchY,
      stepsSinceLaunch: this.stepsSinceLaunch,
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
      movingAtHop: this.movingAtHop,
      driftAirborneS: this.driftAirborneS,
      lastAirborneHorizontal: { x: this.lastAirborneHorizontal.x, z: this.lastAirborneHorizontal.z },
      bufferedJumpElapsedS: this.bufferedJumpElapsedS,
      lastHopShort: this.lastHopShort,
      driftFollowUpS: this.driftFollowUpS,
    };
  }
}
