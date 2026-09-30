// ============================================================
// CAMERA DIRECTOR (M11 lane 2 — ported from the approved Camera Lab)
// Source: prototypes/camera-concepts/src/director/CameraDirector.ts, as
// approved in docs/design-decisions/camera-approval.md. Behaviour and
// constants are unchanged; the only additions are the ones the approvals
// ask for: `clashOrbit: false` (clash-presentation-approval.md 3.6: no
// orbit during the Clash, angle held, approach/height/FOV as approved)
// and `fovPunch` in the output (so the player's "camera shake & zoom"
// setting can drop impact effects without touching the framing).
//
// GDD 48–50: opponent-focused arena camera, semi-over-the-shoulder, high
// and dynamic FOV, distance adapting to the fighters' separation,
// automatic contextual orbit, and dedicated behaviour for high speed,
// close combat, knockback, Clash, Ring-Out and the final hit — without
// ever giving up readability.
//
// Architecture: gameplay describes each tick (FightFrame: positions,
// velocities, attack states, intents such as "hit m=0.37 on the
// opponent"); the director alone decides presentation. Nothing else
// touches the camera. Pure logic, no Three.js: it runs headless in the
// unit tests exactly as it runs on screen, on the fixed 60 Hz tick, so
// render FPS never changes its behaviour.
//
// Modes are CONTEXT WEIGHTS (0..1), not hard cuts: each context blends in
// and out at `transitionSpeed`, and the reported mode is the
// highest-priority context above its threshold, with a minimum hold so the
// label (and anything keyed to it) cannot flicker:
//
//   Clash > RingOut > Finisher > KnockbackFollow > HighSpeed > CloseCombat > CombatFollow
//
// Readability guards (all tunable, all visible in the debug panel): speed
// low-pass before FOV/pull-back, FOV slew limit, distance dead-band, orbit
// speed cap, side-switch cooldown + hold, micro-impact threshold, shake
// cap, floor clearance, Bey clearance, and an off-screen rescue that pulls
// back / widens / re-aims when either Bey leaves the frame.
// ============================================================

import type { CameraIntent, FightFrame, Vec3 } from './FightFrame';
import type { CameraParams } from './CameraParams';
import { angleDelta, clamp, copy3, distXZ, inFrame, lerp3, lerpAngle, set3, smoothK, smoothstep, v3, yawOf } from './frameMath';

// ---------------- DIRECTOR CONSTANTS (shared by A/B/C; the sliders cover the rest) ----------------
const DEG = Math.PI / 180;
/** Arena mode: how far (m) the fight's framing point can wander before the camera starts to follow it. */
const ARENA_FOCUS_DEADZONE_M = 1.5;
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const MAX_FOV_CEILING = 120;             // GDD 49 hard ceiling.
const MIN_FOV = 30;
const SPEED_FOV_START_MPS = 3;           // Speed FOV starts opening above this…
const SPEED_FOV_FULL_MPS = 16;           // …and reaches its strength at this.
const HIGH_SPEED_START_MPS = 9;          // HighSpeed context starts…
const HIGH_SPEED_FULL_MPS = 15;          // …and is full here (a Dash tops out ~18 m/s).
const CLOSE_START_M = 4.5;               // CloseCombat starts under this separation…
const CLOSE_FULL_M = 2.2;                // …and is full under this.
const SEPARATION_REFERENCE_M = 3;        // Distance grows only beyond this separation.
const HEIGHT_PER_DISTANCE = 0.3;         // Eye rises this much per extra metre of distance.
const LOOK_AHEAD_MAX_M = 4;
const ENCOUNTER_HORIZON_S = 1.2;         // Predict meetings up to this far ahead…
const ENCOUNTER_MISS_M = 2.5;            // …when the closest approach is under this.
const AXIS_FREEZE_BELOW_M = 1.5;         // Overlapping Beys: the axis direction is noise, hold it.
const ORBIT_LEAD_GAIN_S = 0.35;          // Lead the fight's rotation by this many seconds.
const ORBIT_LEAD_MAX_RAD = 0.7;
const CLOSE_DRIFT_RAD_S = 0.35;          // Automatic orbit while fighting up close…
const CLOSE_DRIFT_MAX_RAD = 0.9;         // …bounded so it never becomes a spin.
const SIDE_SWITCH_LATERAL_MPS = 5.5;     // Lateral speed that asks for a side change…
const SIDE_SWITCH_HOLD_S = 0.5;          // …only if it lasts this long.
const KNOCK_FOLLOW_KINDS = new Set(['hit', 'stabilityBreak', 'ko', 'ringOut', 'clashResolved']);
const KNOCK_MAGNITUDE_GAIN = 2.5;        // magnitude 0.4 → full follow.
const KNOCK_PULLBACK_M = 1.5;
const KNOCK_HOLD_S = 0.8;                // Follow at least this long, then recover once the Bey slows.
const KNOCK_SETTLED_MPS = 4;
const SHAKE_REF_M = 0.35;                // Shake at magnitude 1, impactShake 1.
const SPEED_SHAKE_REF_M = 0.05;
const SHAKE_MAX_M = 0.45;                // Hard cap: shake can never wreck the frame.
const FOV_PUNCH_DECAY_PER_S = 6;
const CLASH_DISTANCE_FACTOR = 0.8;       // × minDistance at the start of a Clash, pulling in to…
const CLASH_DISTANCE_END_FACTOR = 0.6;   // …this by the end.
const CLASH_HEIGHT_M = 2.4;
const CLASH_ORBIT_RAD_S = 0.45;          // Base Clash orbit, growing with progress and orbitStrength.
const RINGOUT_WATCH_RADIUS_M = 9;        // An airborne Bey this far out, moving outward, is a ring-out candidate.
const RINGOUT_OUTWARD_MPS = 3;
const RINGOUT_BACK_M = 8;
const RINGOUT_UP_M = 3.5;
const RINGOUT_FOV_BONUS = 8;
const FINISHER_S = 2;
const FINISHER_DISTANCE_M = 5;
const FINISHER_HEIGHT_M = 1.6;
const FINISHER_FOV_CUT = 10;
const RESCUE_RISE_PER_S = 2.5;
const RESCUE_FALL_PER_S = 1.2;
const RESCUE_EXTRA_DISTANCE_M = 4;
const RESCUE_EXTRA_FOV = 10;
const FRAME_MARGIN = 0.04;               // "In frame" means inside 96% of the view.
const MODE_THRESHOLD = 0.5;
const MODE_MIN_HOLD_S = 0.25;
// ----------------------------------------------------------------------------------------------

export type CameraMode = 'CombatFollow' | 'HighSpeed' | 'CloseCombat' | 'KnockbackFollow' | 'Clash' | 'RingOut' | 'Finisher';
export const CAMERA_MODES: readonly CameraMode[] = ['Clash', 'RingOut', 'Finisher', 'KnockbackFollow', 'HighSpeed', 'CloseCombat', 'CombatFollow'];

export interface DirectorDebug {
  midpoint: Vec3;
  focusTarget: Vec3;
  lookAheadPoint: Vec3;
  lookAheadVec: Vec3;
  encounterPoint: Vec3 | null;
  distance: number;
  distanceTarget: number;
  yawDeg: number;
  orbitLeadDeg: number;
  side: number;
  speedFiltered: number;
  shake: number;
  rescue: number;
  offscreenFirstS: number;
  offscreenSecondS: number;
  sideSwitches: number;
  modifiers: string[];
}

export interface DirectorOutput {
  readonly eye: Vec3;
  readonly focus: Vec3;
  readonly fov: number;
  /** Add to the eye (and a fraction to the focus) when rendering. */
  readonly shake: Vec3;
  /** The impact FOV punch included in `fov` (degrees). */
  readonly fovPunch: number;
  readonly mode: CameraMode;
  readonly weights: Readonly<Record<CameraMode, number>>;
  readonly debug: DirectorDebug;
}

export interface DirectorOptions {
  /** false: no orbit while the Clash is active — the angle is held from the moment it starts (clash-presentation-approval.md 3.6). Default true (the lab's behaviour). */
  readonly clashOrbit?: boolean;
  /**
   * Floor height under (x, z) for the floor guard (M11 bowls). Default: the
   * flat arena (y = 0), exactly as approved. camera-approval.md §9 asks the
   * guard to follow the concave profile once the bowl is integrated.
   */
  readonly floorHeightAt?: (x: number, z: number) => number;
  /**
   * The in-game arena camera (owner playtest, M11): omitted = the lab's
   * behaviour. When set:
   * - the angle is chosen once, behind the player on the opening fight
   *   axis, and held for the round: no re-aiming at the fight axis, no
   *   velocity-mixed heading, no orbit drift or lead, no shoulder switching,
   *   no impact re-framing turn — so the screen-relative controls keep their
   *   meaning;
   * - it stays dynamic by moving and zooming: the framing point follows the
   *   fight once it leaves a 1.5 m zone (no look-ahead), and distance, FOV,
   *   shake, knockback follow, Clash, ring-out and finisher all apply;
   * - it always stays inside the arena: the eye is never farther than
   *   `containRadiusM` from the centre (pulled in toward the fight and
   *   raised), so the wall is never between the camera and the Beys.
   */
  readonly arena?: { readonly containRadiusM: number; readonly shoulder?: ShoulderRig };
}

/**
 * The in-game over-the-shoulder framing (owner playtest, after M11): "third
 * person behind the Bey, behind and just a little above, over the shoulder
 * — following the Bey, not filming the arena". Replaces the lab's
 * CombatFollow framing (look at the fight's midpoint from 7–17 m out and
 * 4–6 m up) in the game only; every context (Clash, ring-out, finisher,
 * knockback) still blends on top as approved.
 */
export interface ShoulderRig {
  /** Horizontal distance (m) from the player's Bey back to the eye, Beys close together. */
  readonly distanceM: number;
  /** Eye height (m) above the player's Bey at that distance. */
  readonly heightM: number;
  /** Sideways offset (m) of the eye to the player's right: the shoulder. */
  readonly shoulderM: number;
  /** Look point along player → opponent (0 = the player, 1 = the opponent). */
  readonly framing: number;
  /** Look point height (m) above the Beys. */
  readonly lookHeightM: number;
  /** Extra distance (m) per metre of separation beyond 4 m, so the opponent stays in frame. */
  readonly separationPull: number;
  /** Cap on that extra distance (m). */
  readonly maxExtraDistanceM: number;
  /** Look-ahead along the player's velocity (s). */
  readonly lookAheadS: number;
}

/** Below this separation the fight axis is noise (the Beys touching): the shoulder camera holds its angle. */
const SHOULDER_AXIS_MIN_SEP_M = 2.5;
/** Shoulder mode: the opponent may sit this far (rad) off the centre of the view — about the edge of the frame — before the camera turns. */
const SHOULDER_REAIM_ZONE_RAD = 50 * DEG;
/** Shoulder mode: the player must have let go of the directions this long (s) before the camera may turn at all. */
const SHOULDER_REAIM_IDLE_S = 0.6;
/** Shoulder mode: the fastest the camera re-aims (rad/s). */
const SHOULDER_REAIM_RAD_S = 20 * DEG;
/** Shoulder mode: the eye never comes closer than this (m) behind the player, even against the wall. */
const SHOULDER_MIN_DISTANCE_M = 1.8;
/** Shoulder mode: the look point is at least this far (m) ahead of the eye, so the view's direction stays defined. */
const SHOULDER_MIN_LOOK_M = 3;

interface PendingKnock {
  at: number;
  targetIsFirst: boolean;
  magnitude: number;
}

export class CameraDirector {
  private time = 0;
  private initialized = false;
  // Smoothed camera state
  private readonly eye = v3();
  private readonly focus = v3();
  /** Shoulder mode: the focus handed out, its horizontal direction locked to the held angle. */
  private readonly focusOut = v3();
  private fov = 60;
  private yaw = 0;
  private distance = 9;
  private distanceTargetHeld = 9;
  // Filters
  private speedFilt = 0;
  private readonly velFilt = v3();
  private readonly prevVelFilt = v3();
  private readonly accelFilt = v3();
  private readonly lookAhead = v3();
  private axisYaw = 0;
  private prevAxisYaw = 0;
  private axisRate = 0;
  // Contexts
  private readonly weights: Record<CameraMode, number> = { CombatFollow: 1, HighSpeed: 0, CloseCombat: 0, KnockbackFollow: 0, Clash: 0, RingOut: 0, Finisher: 0 };
  private mode: CameraMode = 'CombatFollow';
  private modeCandidate: CameraMode = 'CombatFollow';
  private modeCandidateFor = 0;
  private pending: PendingKnock[] = [];
  private knockLevel = 0;
  private knockAge = 0;
  private knockTargetIsFirst = false;
  private yawKick = 0;
  private closeDrift = 0;
  private finisherTimer = 0;
  private finisherTargetIsFirst = false;
  private clashYaw = 0;
  /** Arena mode: the framing angle the camera holds until the fight axis moves past the dead zone. */
  private heldYaw = 0;
  /** Shoulder mode: how long (s) the player has not been holding a direction. */
  private shoulderIdleS = 0;
  /** Shoulder mode: the smoothed eye distance behind the player. */
  private shoulderDistance = 0;
  /** Arena mode: the framing point, moved only when the fight leaves ARENA_FOCUS_DEADZONE_M around it. */
  private readonly heldFocus: Vec3 = { x: 0, y: 0, z: 0 };
  private wasClash = false;
  // Side
  private side = 1;
  private sideCandidateFor = 0;
  private lastSideSwitchAt = -1e9;
  private sideSwitches = 0;
  // Shake / FOV punch
  private shakeAmp = 0;
  private shakePhase = 0;
  private fovPunch = 0;
  // Readability
  private rescue = 0;
  private rescueTowardFirst = false;
  private offscreenFirst = 0;
  private offscreenSecond = 0;
  // Scratch
  private readonly mid = v3();
  private readonly focusTarget = v3();
  private readonly eyeTarget = v3();
  private readonly laPoint = v3();
  private readonly encounter = v3();
  private readonly tmp = v3();
  private readonly shakeVec = v3();
  private readonly modifiers: string[] = [];
  private hasEncounter = false;

  constructor(
    private readonly params: CameraParams,
    private aspect = 16 / 9,
    private readonly options: DirectorOptions = {},
  ) {}

  setAspect(aspect: number): void {
    if (Number.isFinite(aspect) && aspect > 0.2) this.aspect = aspect;
  }

  /** Forget the smoothed state (a new scenario). */
  reset(): void {
    this.initialized = false;
    this.shoulderIdleS = 0;
    this.time = 0;
    this.pending = [];
    this.knockLevel = 0;
    this.yawKick = 0;
    this.closeDrift = 0;
    this.finisherTimer = 0;
    this.shakeAmp = 0;
    this.fovPunch = 0;
    this.rescue = 0;
    this.offscreenFirst = 0;
    this.offscreenSecond = 0;
    this.sideSwitches = 0;
    this.side = 1;
    this.lastSideSwitchAt = -1e9;
    this.speedFilt = 0;
    set3(this.velFilt, 0, 0, 0);
    set3(this.prevVelFilt, 0, 0, 0);
    set3(this.accelFilt, 0, 0, 0);
    set3(this.lookAhead, 0, 0, 0);
    for (const m of CAMERA_MODES) this.weights[m] = m === 'CombatFollow' ? 1 : 0;
    this.mode = 'CombatFollow';
    this.wasClash = false;
  }

  tick(frame: FightFrame, dt: number): DirectorOutput {
    const P = this.params;
    this.time += dt;
    this.modifiers.length = 0;
    const p1 = frame.first.position;
    const p2 = frame.second.position;
    lerp3(this.mid, p1, p2, 0.5);
    const sep = distXZ(p1, p2);

    // ---- Signals, filtered so noise can't make the FOV or distance pulse ----
    // During a Clash both Beys are held in place; like main.ts, the camera treats them as still.
    const still = frame.clashActive;
    const kSpeed = smoothK(2 * Math.PI * P.speedFilterHz, dt);
    this.speedFilt += ((still ? 0 : Math.max(frame.first.speed, frame.second.speed)) - this.speedFilt) * kSpeed;
    copy3(this.prevVelFilt, this.velFilt);
    lerp3(this.velFilt, this.velFilt, still ? ZERO : frame.first.velocity, kSpeed);
    const ax = (this.velFilt.x - this.prevVelFilt.x) / dt;
    const az = (this.velFilt.z - this.prevVelFilt.z) / dt;
    lerp3(this.accelFilt, this.accelFilt, set3(this.tmp, ax, 0, az), kSpeed);

    // Fight axis (player → opponent). Held while the Beys overlap.
    if (sep > AXIS_FREEZE_BELOW_M) this.axisYaw = yawOf(p2.x - p1.x, p2.z - p1.z);
    if (!this.initialized) this.prevAxisYaw = this.axisYaw;
    const rawAxisRate = angleDelta(this.prevAxisYaw, this.axisYaw) / dt;
    this.axisRate += (rawAxisRate - this.axisRate) * smoothK(4, dt);
    this.prevAxisYaw = this.axisYaw;

    // ---- Intents → contexts ----
    this.consumeIntents(frame.intents);
    this.updateKnock(frame, dt);
    if (this.finisherTimer > 0) this.finisherTimer = Math.max(0, this.finisherTimer - dt);

    const clashRaw = frame.clashActive ? 1 : 0;
    const ringOutRaw = this.ringOutRaw(frame);
    const finisherRaw = this.finisherTimer > 0 || (frame.roundOver && frame.ringOutIsFirst === null) ? 1 : 0;
    const highRaw = smoothstep(HIGH_SPEED_START_MPS, HIGH_SPEED_FULL_MPS, this.speedFilt);
    const closeRaw = smoothstep(CLOSE_START_M, CLOSE_FULL_M, sep) * (1 - 0.7 * highRaw);
    const kT = smoothK(P.transitionSpeed, dt);
    const approach = (m: CameraMode, raw: number): void => {
      this.weights[m] += (raw - this.weights[m]) * kT;
    };
    approach('Clash', clashRaw);
    approach('RingOut', ringOutRaw);
    approach('Finisher', finisherRaw);
    approach('KnockbackFollow', this.knockLevel);
    approach('HighSpeed', highRaw);
    approach('CloseCombat', closeRaw);
    this.weights.CombatFollow = 1;
    this.updateModeLabel(dt);

    const wClash = this.weights.Clash;
    const wRing = this.weights.RingOut;
    const wFin = this.weights.Finisher;
    const wKnock = this.weights.KnockbackFollow;
    const wHigh = this.weights.HighSpeed;
    const wClose = this.weights.CloseCombat;

    // ---- Look-ahead (direction of movement) ----
    const la = this.tmp;
    set3(
      la,
      (this.velFilt.x * P.velocityLookAhead + (still ? 0 : frame.second.velocity.x) * P.velocityLookAhead * 0.5 + this.accelFilt.x * P.accelLookAhead) * P.lookAheadStrength,
      0,
      (this.velFilt.z * P.velocityLookAhead + (still ? 0 : frame.second.velocity.z) * P.velocityLookAhead * 0.5 + this.accelFilt.z * P.accelLookAhead) * P.lookAheadStrength,
    );
    const laLen = Math.hypot(la.x, la.z);
    if (laLen > LOOK_AHEAD_MAX_M) set3(la, (la.x / laLen) * LOOK_AHEAD_MAX_M, 0, (la.z / laLen) * LOOK_AHEAD_MAX_M);
    lerp3(this.lookAhead, this.lookAhead, la, smoothK(P.rotationDamping * 0.6, dt));

    // ---- Encounter prediction ("framing prevendo encontros rápidos") ----
    const encounterW = still ? 0 : this.predictEncounter(frame) * P.encounterWeight;

    // ---- Focus target ----
    const ft = this.focusTarget;
    lerp3(ft, p1, p2, P.framingBias);
    if (this.options.arena && !this.options.arena.shoulder) {
      // Arena mode: the framing point only moves once the fight has left a
      // small zone around it, so ordinary moves don't drag the camera along.
      if (!this.initialized) copy3(this.heldFocus, ft);
      const dx = ft.x - this.heldFocus.x;
      const dz = ft.z - this.heldFocus.z;
      const d = Math.hypot(dx, dz);
      if (d > ARENA_FOCUS_DEADZONE_M) {
        this.heldFocus.x += (dx / d) * (d - ARENA_FOCUS_DEADZONE_M);
        this.heldFocus.z += (dz / d) * (d - ARENA_FOCUS_DEADZONE_M);
      }
      ft.x = this.heldFocus.x;
      ft.z = this.heldFocus.z;
    } else {
      ft.x += this.lookAhead.x;
      ft.z += this.lookAhead.z;
    }
    if (this.hasEncounter) lerp3(ft, ft, this.encounter, encounterW * 0.5);
    const knockPos = this.knockTargetIsFirst ? p1 : p2;
    lerp3(ft, ft, knockPos, wKnock * 0.6 * P.knockbackFollow);
    if (this.rescue > 0) lerp3(ft, ft, this.rescueTowardFirst ? p1 : p2, this.rescue * 0.5 * clamp(P.offscreenRescue, 0, 1));
    ft.y = (p1.y + p2.y) / 2 + P.verticalOffset;
    set3(this.laPoint, ft.x, ft.y, ft.z);

    // ---- Yaw: behind the player on the fight axis, to one shoulder, orbiting with the action ----
    const arena = this.options.arena;
    let baseYaw = this.axisYaw;
    if (!arena && frame.first.speed > 3 && P.opponentWeight < 1) baseYaw = lerpAngle(yawOf(this.velFilt.x, this.velFilt.z), this.axisYaw, P.opponentWeight);
    const orbitLead = arena ? 0 : clamp(this.axisRate * ORBIT_LEAD_GAIN_S, -ORBIT_LEAD_MAX_RAD, ORBIT_LEAD_MAX_RAD) * P.orbitStrength;
    if (arena) this.closeDrift = 0;
    else {
      this.closeDrift += (wClose > 0.5 ? CLOSE_DRIFT_RAD_S * P.orbitStrength * dt : -this.closeDrift * smoothK(0.5, dt));
      this.closeDrift = clamp(this.closeDrift, -CLOSE_DRIFT_MAX_RAD, CLOSE_DRIFT_MAX_RAD);
      this.updateSide(frame, dt, wClash + wFin + wRing);
    }
    let yawTarget = baseYaw + Math.PI + this.side * P.lateralOffset * DEG + orbitLead + this.closeDrift + this.yawKick;
    const shoulder = arena?.shoulder;
    if (arena && shoulder) {
      // Over the shoulder, behind the player — but it does not follow every
      // move of the opponent (owner playtest, after M11: following the
      // player → opponent line turned the camera through a full circle as
      // the AI circled a standing player, and every turn changed what the
      // screen-relative arrows mean; a 25° zone still turned it 60°+ while
      // the player stood still). The angle is held. It never turns while
      // the player holds a direction, nor in the first moments after they
      // let go (between taps); only when the opponent is about to leave
      // the frame, only by the amount it has left that zone, and slowly.
      // Up close the line is noise: hold.
      const wanted = baseYaw + Math.PI;
      this.shoulderIdleS = frame.playerSteering ? 0 : this.shoulderIdleS + dt;
      if (!this.initialized) this.heldYaw = wanted;
      else if (sep > SHOULDER_AXIS_MIN_SEP_M && this.shoulderIdleS >= SHOULDER_REAIM_IDLE_S) {
        const off = angleDelta(this.heldYaw, wanted);
        if (Math.abs(off) > SHOULDER_REAIM_ZONE_RAD) this.heldYaw += Math.sign(off) * Math.min(Math.abs(off) - SHOULDER_REAIM_ZONE_RAD, SHOULDER_REAIM_RAD_S * dt);
      }
      yawTarget = this.heldYaw;
    } else if (arena) {
      // The angle is chosen once, behind the player on the opening fight
      // axis, and held for the round (owner playtest, after M11). It stays
      // dynamic by moving and zooming (below), and the eye is pulled in and
      // raised, never swung, to stay inside the arena.
      if (!this.initialized) this.heldYaw = baseYaw + Math.PI;
      yawTarget = this.heldYaw;
    }
    if (Math.abs(orbitLead) > 0.05) this.modifiers.push(`órbita ${(orbitLead / DEG).toFixed(0)}°`);
    if (Math.abs(this.yawKick) > 0.02) this.modifiers.push(`reenquadramento ${(this.yawKick / DEG).toFixed(0)}°`);

    // Clash: a contained orbit around the confrontation point.
    if (frame.clashActive && !this.wasClash) this.clashYaw = this.yaw;
    this.wasClash = frame.clashActive;
    if (wClash > 0.01) {
      if (this.options.clashOrbit !== false) this.clashYaw += CLASH_ORBIT_RAD_S * (0.5 + P.orbitStrength) * (0.6 + frame.clashProgress) * dt;
      yawTarget = lerpAngle(yawTarget, this.clashYaw, wClash);
    }

    // Orbit speed cap (anti-nausea) + damping.
    const maxStep = P.orbitSpeed * DEG * dt;
    const step = clamp(angleDelta(this.yaw, yawTarget) * smoothK(P.orbitDamping, dt), -maxStep, maxStep);
    if (!this.initialized) this.yaw = yawTarget;
    else this.yaw += step;

    // ---- Distance ----
    let distTarget = P.minDistance + P.separationResponse * Math.max(0, sep - SEPARATION_REFERENCE_M);
    distTarget += P.highSpeedPullback * wHigh - P.closePushIn * wClose + encounterW * 1.2 + wKnock * KNOCK_PULLBACK_M * P.knockbackFollow;
    distTarget += this.rescue * RESCUE_EXTRA_DISTANCE_M * P.offscreenRescue;
    distTarget = clamp(distTarget, Math.max(2.5, P.minDistance - P.closePushIn), P.maxDistance + this.rescue * RESCUE_EXTRA_DISTANCE_M);
    const clashDist = P.minDistance * (CLASH_DISTANCE_FACTOR + (CLASH_DISTANCE_END_FACTOR - CLASH_DISTANCE_FACTOR) * frame.clashProgress);
    distTarget += (clashDist - distTarget) * wClash;
    if (Math.abs(distTarget - this.distanceTargetHeld) > P.distanceDeadband || wClash > 0.01 || wFin > 0.01) this.distanceTargetHeld = distTarget;
    if (!this.initialized) this.distance = this.distanceTargetHeld;
    this.distance += (this.distanceTargetHeld - this.distance) * smoothK(P.positionDamping, dt);

    let height = P.cameraHeight + (this.distance - P.minDistance) * HEIGHT_PER_DISTANCE + wHigh * 0.6 - wClose * 0.4 * P.orbitStrength;
    height += (CLASH_HEIGHT_M - height) * wClash;

    // ---- Eye target from yaw/distance/height ----
    const et = this.eyeTarget;
    set3(et, ft.x + Math.sin(this.yaw) * this.distance, ft.y + height, ft.z + Math.cos(this.yaw) * this.distance);
    if (shoulder) {
      // Behind the player's Bey, a little above it and off its right
      // shoulder, looking ahead toward the opponent: the player in the
      // lower part of the frame, the opponent ahead, the horizon visible.
      let d = shoulder.distanceM + Math.min(shoulder.maxExtraDistanceM, shoulder.separationPull * Math.max(0, sep - 4));
      d += wKnock * 0.8 + wHigh * 0.6;
      this.shoulderDistance += (d - this.shoulderDistance) * (this.initialized ? smoothK(P.positionDamping, dt) : 1);
      const back = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
      const right = { x: -back.z, z: back.x };
      // With the player's back to the wall the eye can't go that far back:
      // bring it in (rising a little) and pull the look point toward the
      // player in proportion, so the player stays in frame.
      let dBack = this.shoulderDistance;
      const R = arena.containRadiusM;
      const bx = p1.x + right.x * shoulder.shoulderM;
      const bz = p1.z + right.z * shoulder.shoulderM;
      if (Math.hypot(bx + back.x * dBack, bz + back.z * dBack) > R) {
        const b = bx * back.x + bz * back.z;
        const c = bx * bx + bz * bz - R * R;
        dBack = clamp(-b + Math.sqrt(Math.max(0, b * b - c)), SHOULDER_MIN_DISTANCE_M, dBack);
      }
      const inFraction = this.shoulderDistance > 0 ? dBack / this.shoulderDistance : 1;
      // Brought in, it also comes down in proportion, so the view stays behind the Bey instead of looking down on it.
      const up = (shoulder.heightM + (this.shoulderDistance - shoulder.distanceM) * 0.25) * (0.55 + 0.45 * inFraction);
      set3(et, bx + back.x * dBack, p1.y + up, bz + back.z * dBack);
      lerp3(ft, p1, p2, shoulder.framing * inFraction);
      ft.x += this.velFilt.x * shoulder.lookAheadS;
      ft.z += this.velFilt.z * shoulder.lookAheadS;
      ft.y = p1.y * (1 - shoulder.framing * inFraction) + p2.y * shoulder.framing * inFraction + shoulder.lookHeightM;
      const knockPos2 = this.knockTargetIsFirst ? p1 : p2;
      lerp3(ft, ft, knockPos2, wKnock * 0.6 * P.knockbackFollow);
      // The view looks straight along the held angle: the framing point is
      // kept on that line (only its distance and height follow the fight).
      // Aiming at a point between the Beys turned the view ~15–40° as the
      // opponent moved sideways — and with it what the arrows mean on
      // screen (owner playtest: "not respecting my movement commands").
      const along = Math.max(1, (ft.x - et.x) * -back.x + (ft.z - et.z) * -back.z);
      ft.x = et.x - back.x * along;
      ft.z = et.z - back.z * along;
      set3(this.laPoint, ft.x, ft.y, ft.z);
    }
    if (wClash > 0.01) {
      set3(this.tmp, this.mid.x + Math.sin(this.yaw) * this.distance, this.mid.y + CLASH_HEIGHT_M, this.mid.z + Math.cos(this.yaw) * this.distance);
      lerp3(et, et, this.tmp, wClash);
      set3(this.tmp, this.mid.x, this.mid.y + 0.5, this.mid.z);
      lerp3(ft, ft, this.tmp, wClash);
    }

    // Ring-out: stay on the arena side, rise, and keep the flying Bey framed.
    if (wRing > 0.01) {
      const flyingIsFirst = frame.ringOutIsFirst ?? this.ringOutCandidateIsFirst(frame);
      const f = flyingIsFirst ? frame.first : frame.second;
      const r = Math.hypot(f.position.x, f.position.z) || 1;
      const rx = f.position.x / r;
      const rz = f.position.z / r;
      set3(this.tmp, f.position.x - rx * RINGOUT_BACK_M, Math.max(f.position.y, 0) + RINGOUT_UP_M, f.position.z - rz * RINGOUT_BACK_M);
      lerp3(et, et, this.tmp, wRing);
      set3(this.tmp, f.position.x + f.velocity.x * 0.25, f.position.y + f.velocity.y * 0.1, f.position.z + f.velocity.z * 0.25);
      lerp3(ft, ft, this.tmp, wRing);
    }
    // Finisher: low, closer shot on the struck Bey.
    if (wFin > 0.01) {
      const target = this.finisherTargetIsFirst ? frame.first : frame.second;
      const dx = this.eye.x - target.position.x;
      const dz = this.eye.z - target.position.z;
      const dl = Math.hypot(dx, dz) || 1;
      set3(this.tmp, target.position.x + (dx / dl) * FINISHER_DISTANCE_M, target.position.y + FINISHER_HEIGHT_M, target.position.z + (dz / dl) * FINISHER_DISTANCE_M);
      lerp3(et, et, this.tmp, wFin * (1 - wRing * 0.6));
      set3(this.tmp, target.position.x, target.position.y + 0.4, target.position.z);
      lerp3(ft, ft, this.tmp, wFin * (1 - wRing * 0.6));
    }

    // ---- Smooth ----
    if (!this.initialized) {
      copy3(this.eye, et);
      copy3(this.focus, ft);
    } else {
      lerp3(this.eye, this.eye, et, smoothK(P.positionDamping, dt));
      lerp3(this.focus, this.focus, ft, smoothK(P.rotationDamping, dt));
    }

    // ---- Guard: inside the arena (arena mode) ----
    if (arena) this.containEye(arena.containRadiusM);

    // ---- Guards: floor, Beys ----
    const floorY = this.options.floorHeightAt ? this.options.floorHeightAt(this.eye.x, this.eye.z) : 0;
    if (this.eye.y < floorY + P.floorClearance) {
      this.eye.y = floorY + P.floorClearance;
      this.modifiers.push('proteção: chão');
    }
    for (const f of [p1, p2]) {
      const d = distXZ(this.eye, f);
      if (d < P.beyClearance && this.eye.y - f.y < P.beyClearance) {
        const dx = this.eye.x - f.x;
        const dz = this.eye.z - f.z;
        const l = d || 1;
        this.eye.x = f.x + (dx / l) * P.beyClearance;
        this.eye.z = f.z + (dz / l) * P.beyClearance;
        this.modifiers.push('proteção: Bey');
      }
    }
    // The Bey guard can push the eye outward again: contain once more (arena mode).
    if (arena) this.containEye(arena.containRadiusM);

    // Over the shoulder the view always faces the held angle, whatever
    // the guards did to the eye (pushed off a Bey, brought in at the wall
    // until it is nearly above the player): the screen's up/right — what
    // the arrows mean — then turn only when the held angle turns. Clash,
    // ring-out and finisher shots keep their own aim.
    copy3(this.focusOut, this.focus);
    if (shoulder) {
      const lock = 1 - Math.max(wClash, wRing, wFin);
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const along = Math.max(SHOULDER_MIN_LOOK_M, (this.focus.x - this.eye.x) * fx + (this.focus.z - this.eye.z) * fz);
      this.focusOut.x += (this.eye.x + fx * along - this.focus.x) * lock;
      this.focusOut.z += (this.eye.z + fz * along - this.focus.z) * lock;
    }

    // ---- FOV ----
    const speedNorm = clamp((this.speedFilt - SPEED_FOV_START_MPS) / (SPEED_FOV_FULL_MPS - SPEED_FOV_START_MPS), 0, 1);
    let fovTarget = P.baseFov + (P.maxFov - P.baseFov) * P.fovSpeedStrength * Math.pow(speedNorm, P.fovSpeedCurve);
    fovTarget += (P.baseFov - 4 + frame.clashProgress * 10 - fovTarget) * wClash;
    fovTarget += RINGOUT_FOV_BONUS * wRing - FINISHER_FOV_CUT * wFin * (1 - wRing);
    fovTarget += this.rescue * RESCUE_EXTRA_FOV * P.offscreenRescue;
    fovTarget = clamp(fovTarget, MIN_FOV, Math.min(MAX_FOV_CEILING, Math.max(P.maxFov, P.baseFov) + this.rescue * RESCUE_EXTRA_FOV));
    if (!this.initialized) this.fov = fovTarget;
    const fovStep = (fovTarget - this.fov) * smoothK(P.fovDamping, dt);
    const fovLimit = P.fovMaxRate * dt;
    this.fov += clamp(fovStep, -fovLimit, fovLimit);
    this.fovPunch *= Math.exp(-FOV_PUNCH_DECAY_PER_S * dt);
    const fovOut = clamp(this.fov + this.fovPunch, MIN_FOV, MAX_FOV_CEILING);

    // ---- Readability: are both Beys in frame? ----
    const firstIn = inFrame(p1, this.eye, this.focusOut, fovOut, this.aspect, FRAME_MARGIN);
    const secondIn = inFrame(p2, this.eye, this.focusOut, fovOut, this.aspect, FRAME_MARGIN);
    const inPlay = !frame.roundOver;
    if (!firstIn && inPlay) this.offscreenFirst += dt;
    if (!secondIn && inPlay) this.offscreenSecond += dt;
    if ((!firstIn || !secondIn) && inPlay && wRing < 0.5) {
      this.rescue = Math.min(1, this.rescue + RESCUE_RISE_PER_S * dt);
      this.rescueTowardFirst = !firstIn;
      this.modifiers.push(`resgate: ${!secondIn ? 'oponente' : 'jogador'} fora do quadro`);
    } else {
      this.rescue = Math.max(0, this.rescue - RESCUE_FALL_PER_S * dt);
    }

    // ---- Shake ----
    this.shakeAmp *= Math.exp(-P.shakeDecay * dt);
    const speedShake = P.speedShake * SPEED_SHAKE_REF_M * smoothstep(10, 16, this.speedFilt);
    const amp = Math.min(SHAKE_MAX_M, (this.shakeAmp + speedShake) * P.shakeIntensity);
    this.shakePhase += dt * 2 * Math.PI * 17;
    set3(this.shakeVec, Math.sin(this.shakePhase) * amp, Math.sin(this.shakePhase * 1.7 + 1.3) * amp * 0.6, Math.cos(this.shakePhase * 1.3) * amp);

    if (wHigh > 0.05) this.modifiers.push(`alta velocidade ${(wHigh * 100).toFixed(0)}%`);
    if (wClose > 0.05) this.modifiers.push(`combate próximo ${(wClose * 100).toFixed(0)}%`);
    if (wKnock > 0.05) this.modifiers.push(`knockback follow ${(wKnock * 100).toFixed(0)}%`);
    if (encounterW > 0.05) this.modifiers.push(`encontro previsto ${(encounterW * 100).toFixed(0)}%`);
    if (this.fovPunch > 0.3) this.modifiers.push(`soco de FOV +${this.fovPunch.toFixed(1)}°`);

    this.initialized = true;
    return {
      eye: this.eye,
      focus: this.focusOut,
      fov: fovOut,
      shake: this.shakeVec,
      fovPunch: Math.min(this.fovPunch, fovOut - MIN_FOV),
      mode: this.mode,
      weights: this.weights,
      debug: {
        midpoint: this.mid,
        focusTarget: this.focusTarget,
        lookAheadPoint: this.laPoint,
        lookAheadVec: this.lookAhead,
        encounterPoint: this.hasEncounter && encounterW > 0.01 ? this.encounter : null,
        distance: this.distance,
        distanceTarget: this.distanceTargetHeld,
        yawDeg: ((this.yaw / DEG) % 360 + 360) % 360,
        orbitLeadDeg: orbitLead / DEG,
        side: this.side,
        speedFiltered: this.speedFilt,
        shake: amp,
        rescue: this.rescue,
        offscreenFirstS: this.offscreenFirst,
        offscreenSecondS: this.offscreenSecond,
        sideSwitches: this.sideSwitches,
        modifiers: this.modifiers,
      },
    };
  }

  /** Arena mode: never let the eye past `radius` from the centre (pulled in toward the focus, raised to keep the framing). */
  private containEye(radius: number): void {
    const r = Math.hypot(this.eye.x, this.eye.z);
    if (r <= radius) return;
    const f = this.focus;
    if (Math.hypot(f.x, f.z) >= radius) {
      // The focus itself is outside (a ring-out flight): just bring the eye back to the rim line.
      this.eye.x *= radius / r;
      this.eye.z *= radius / r;
    } else {
      // Where the focus → eye line crosses the circle of `radius`.
      const dx = this.eye.x - f.x;
      const dz = this.eye.z - f.z;
      const a = dx * dx + dz * dz;
      const b = 2 * (f.x * dx + f.z * dz);
      const c = f.x * f.x + f.z * f.z - radius * radius;
      const t = clamp((-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a), 0, 1);
      const lost = Math.sqrt(a) * (1 - t);
      this.eye.x = f.x + dx * t;
      this.eye.z = f.z + dz * t;
      // Raised to keep the framing — but an over-the-shoulder eye stays low (it is already close).
      this.eye.y += lost * (this.options.arena?.shoulder ? 0.2 : 0.5);
    }
    this.modifiers.push('proteção: dentro da arena');
  }

  private consumeIntents(intents: readonly CameraIntent[]): void {
    const P = this.params;
    for (const e of intents) {
      if (e.kind === 'ko' || e.kind === 'ringOut') {
        this.finisherTimer = FINISHER_S;
        this.finisherTargetIsFirst = e.targetIsFirst ?? false;
      }
      if (e.kind === 'clashStart' || e.kind === 'landing' && e.magnitude < P.microImpactThreshold * 2) continue;
      if (e.magnitude < P.microImpactThreshold) continue; // micro-impacts never move the camera
      this.shakeAmp = Math.max(this.shakeAmp, e.magnitude * SHAKE_REF_M * P.impactShake);
      this.fovPunch = Math.max(this.fovPunch, e.magnitude * P.impactFovPunch);
      if (KNOCK_FOLLOW_KINDS.has(e.kind) && e.targetIsFirst !== null) {
        this.pending.push({ at: this.time + P.knockbackDelay, targetIsFirst: e.targetIsFirst, magnitude: e.magnitude });
      }
    }
  }

  private updateKnock(frame: FightFrame, dt: number): void {
    const P = this.params;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const k = this.pending[i]!;
      if (k.at > this.time) continue;
      this.pending.splice(i, 1);
      // The context's activity follows the impact; how far the framing moves is knockbackFollow.
      const level = clamp(k.magnitude * KNOCK_MAGNITUDE_GAIN, 0, 1);
      if (level >= this.knockLevel * 0.8) {
        this.knockLevel = Math.max(this.knockLevel, level);
        this.knockTargetIsFirst = k.targetIsFirst;
        this.knockAge = 0;
        // Re-compose on big impacts: swing so the launch reads sideways across the frame.
        const f = k.targetIsFirst ? frame.first : frame.second;
        const camFx = this.focus.x - this.eye.x;
        const camFz = this.focus.z - this.eye.z;
        const cross = camFx * f.velocity.z - camFz * f.velocity.x;
        this.yawKick = clamp(this.yawKick + Math.sign(cross || 1) * P.impactReframe * DEG * k.magnitude, -0.7, 0.7);
      }
    }
    this.knockAge += dt;
    const target = this.knockTargetIsFirst ? frame.first : frame.second;
    if (this.knockAge > KNOCK_HOLD_S || target.speed < KNOCK_SETTLED_MPS) this.knockLevel *= Math.exp(-P.recoverySpeed * dt);
    if (this.knockLevel < 0.01) this.knockLevel = 0;
    this.yawKick *= Math.exp(-P.recoverySpeed * dt);
  }

  private ringOutCandidateIsFirst(frame: FightFrame): boolean {
    return this.outwardSpeed(frame.first) >= this.outwardSpeed(frame.second);
  }

  private outwardSpeed(f: FightFrame['first']): number {
    const r = Math.hypot(f.position.x, f.position.z);
    if (!f.airborne || r < RINGOUT_WATCH_RADIUS_M) return 0;
    return (f.position.x * f.velocity.x + f.position.z * f.velocity.z) / r;
  }

  private ringOutRaw(frame: FightFrame): number {
    if (frame.ringOutIsFirst !== null) return 1;
    // A Bey flying outward near the rim: anticipate the ring-out camera a little.
    return Math.max(this.outwardSpeed(frame.first), this.outwardSpeed(frame.second)) > RINGOUT_OUTWARD_MPS ? 0.6 : 0;
  }

  private predictEncounter(frame: FightFrame): number {
    const a = frame.first;
    const b = frame.second;
    const dx = b.position.x - a.position.x;
    const dz = b.position.z - a.position.z;
    const vx = b.velocity.x - a.velocity.x;
    const vz = b.velocity.z - a.velocity.z;
    const vv = vx * vx + vz * vz;
    this.hasEncounter = false;
    if (vv < 4) return 0;
    const tca = -(dx * vx + dz * vz) / vv;
    if (tca <= 0 || tca > ENCOUNTER_HORIZON_S) return 0;
    const cx = dx + vx * tca;
    const cz = dz + vz * tca;
    if (Math.hypot(cx, cz) > ENCOUNTER_MISS_M) return 0;
    this.hasEncounter = true;
    set3(
      this.encounter,
      (a.position.x + a.velocity.x * tca + b.position.x + b.velocity.x * tca) / 2,
      (a.position.y + b.position.y) / 2,
      (a.position.z + a.velocity.z * tca + b.position.z + b.velocity.z * tca) / 2,
    );
    return 1 - tca / ENCOUNTER_HORIZON_S;
  }

  private updateSide(frame: FightFrame, dt: number, cinematicWeight: number): void {
    const P = this.params;
    if (P.sideSwitchCooldown >= 60 || cinematicWeight > 0.3) {
      this.sideCandidateFor = 0;
      return;
    }
    // Screen-right of the current camera, in XZ.
    const fx = this.focus.x - this.eye.x;
    const fz = this.focus.z - this.eye.z;
    const fl = Math.hypot(fx, fz) || 1;
    const rx = -fz / fl;
    const rz = fx / fl;
    const lateral = frame.first.velocity.x * rx + frame.first.velocity.z * rz;
    const wantSide = Math.sign(lateral);
    if (Math.abs(lateral) > SIDE_SWITCH_LATERAL_MPS && wantSide !== this.side) this.sideCandidateFor += dt;
    else this.sideCandidateFor = 0;
    if (this.sideCandidateFor > SIDE_SWITCH_HOLD_S && this.time - this.lastSideSwitchAt > P.sideSwitchCooldown) {
      this.side = wantSide;
      this.lastSideSwitchAt = this.time;
      this.sideSwitches++;
      this.sideCandidateFor = 0;
    }
  }

  private updateModeLabel(dt: number): void {
    let best: CameraMode = 'CombatFollow';
    for (const m of CAMERA_MODES) {
      if (m !== 'CombatFollow' && this.weights[m] >= MODE_THRESHOLD) {
        best = m;
        break;
      }
    }
    if (best === this.mode) {
      this.modeCandidateFor = 0;
      return;
    }
    if (best !== this.modeCandidate) {
      this.modeCandidate = best;
      this.modeCandidateFor = 0;
    }
    this.modeCandidateFor += dt;
    if (this.modeCandidateFor >= MODE_MIN_HOLD_S) this.mode = best;
  }
}
