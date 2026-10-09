// ============================================================
// LAUNCH SEQUENCE — the round start of the Launch System A (Timing Snap)
// `ROUND START → Beys mounted in physical launchers → the player chooses the entry point → Timing Snap → the launcher
// releases → both Beys travel into the stage → first contact → COMBAT at once` (design doc §2). Pure and deterministic: it
// counts fixed ticks, reads one input record per side per tick and produces poses for the Beys and a LaunchResult. It owns
// no Three.js object and no physics body; the session moves the bodies, the presentation draws the rigs.
//
// There is no post-landing phase here by design (§2, §6, §10): the sequence is `done` on the very tick the last Bey touches
// down, and the match's first tick follows it.
// ============================================================

import { FIXED_DELTA_SECONDS } from '../physics/fixed-step/FixedTimestepLoop';
import { flightPlan, flightPose, clampLaunchTarget, defaultLaunchTarget, launcherForward, launcherRight, socketPosition, type FlightPlan, type GroundPoint, type LaunchArena, type Vec3 } from './LaunchGeometry';
import { launchArrivals, type LaunchBeyShape, type LaunchResult } from './LaunchResult';
import { LAUNCH_SIDES, LAUNCH_TUNING, launchGrade, launchOutcomeFor, markerAt, timingQuality, type LaunchGrade, type LaunchSide } from './LaunchTuning';

export type LaunchPhase = 'mounted' | 'armed' | 'release' | 'flight' | 'landed';

/** Who decides a side's launch: a person (moves the point, presses LAUNCH) or the match itself (a prepared plan, e.g. the AI's). */
export type LaunchDriver =
  | { readonly kind: 'person' }
  | { readonly kind: 'plan'; readonly target: GroundPoint; readonly quality: number; /** Extra seconds before the Bey leaves its launcher (the AI lets go a beat early or late). */ readonly releaseLagS?: number };

export interface LaunchSideSetup {
  readonly driver: LaunchDriver;
  readonly shape: LaunchBeyShape;
}

export interface LaunchSequenceOptions {
  readonly arena: LaunchArena;
  readonly sides: Record<LaunchSide, LaunchSideSetup>;
}

/** What one person-driven side did this tick. `aim` is a screen vector (x right, y up, length 0..1) as the input layer reads it. */
export interface LaunchSideInput {
  readonly aim: { readonly x: number; readonly y: number };
  readonly press: boolean;
}

export type LaunchInputs = Partial<Record<LaunchSide, LaunchSideInput>>;

/** Things that happened on one tick, for the presentation (never read by the simulation). */
export interface LaunchEvents {
  /** The tick the launchers released. */
  readonly released: boolean;
  /** Sides whose Bey touched down this tick. */
  readonly landed: readonly LaunchSide[];
}

export type LaunchBeyState = 'mounted' | 'flying' | 'landed';

export interface LaunchBeyPose {
  readonly state: LaunchBeyState;
  readonly position: Vec3;
  /** 0..1 along the flight (0 mounted, 1 landed). */
  readonly flightProgress: number;
  readonly leanRad: number;
}

/** A frozen reading of the sequence for the HUD and the presentation. */
export interface LaunchView {
  readonly phase: LaunchPhase;
  /** Seconds since the sequence began / since the marker started. */
  readonly elapsedS: number;
  readonly armedS: number;
  /** The Timing Snap marker, 0..1. */
  readonly marker: number;
  readonly targets: Record<LaunchSide, GroundPoint>;
  /** Quality of each side once it has pressed LAUNCH (or been released), else null. */
  readonly qualities: Record<LaunchSide, number | null>;
  readonly pressed: Record<LaunchSide, boolean>;
  /** The grade of the person's launch (or of the first side's) once released. */
  readonly grade: LaunchGrade | null;
  /** True when a person has to press LAUNCH for the sequence to go on. */
  readonly waitingForPerson: boolean;
  readonly done: boolean;
}

interface SideRuntime {
  target: GroundPoint;
  pressed: boolean;
  quality: number | null;
  plan: FlightPlan | null;
  /** Seconds after the release at which this side leaves. */
  delayS: number;
  landed: boolean;
}

export class LaunchSequence {
  private readonly arena: LaunchArena;
  private readonly setup: Record<LaunchSide, LaunchSideSetup>;
  private readonly runtime: Record<LaunchSide, SideRuntime>;
  private tick = 0;
  private phase: LaunchPhase = 'mounted';
  private armedTicks = 0;
  private releaseTick = -1;
  private readonly dt = FIXED_DELTA_SECONDS;
  private result: LaunchResult | null = null;
  private poses: Record<LaunchSide, LaunchBeyPose>;

  constructor(options: LaunchSequenceOptions) {
    this.arena = options.arena;
    this.setup = options.sides;
    const runtimeFor = (side: LaunchSide): SideRuntime => {
      const driver = this.setup[side].driver;
      const target = driver.kind === 'plan' ? clampLaunchTarget(driver.target, this.arena, side) : defaultLaunchTarget(side, this.arena);
      return { target, pressed: false, quality: null, plan: null, delayS: (side === 'second' ? LAUNCH_TUNING.secondLeadS : 0) + (driver.kind === 'plan' ? Math.max(0, driver.releaseLagS ?? 0) : 0), landed: false };
    };
    this.runtime = { first: runtimeFor('first'), second: runtimeFor('second') };
    this.poses = { first: this.mountedPose('first'), second: this.mountedPose('second') };
  }

  /** True once every Bey has touched down; the match's first tick comes next. */
  get done(): boolean {
    return this.phase === 'landed';
  }

  get currentPhase(): LaunchPhase {
    return this.phase;
  }

  /** Ticks stepped so far. */
  get ticks(): number {
    return this.tick;
  }

  /** The result, once released (the targets as chosen, the timing as pressed). Null before. */
  getResult(): LaunchResult | null {
    return this.result;
  }

  getPose(side: LaunchSide): LaunchBeyPose {
    return this.poses[side];
  }

  /** Moves a person's entry point to a ground position (a click or a drag on the arena), clamped to the valid area. Only before the release. */
  setTarget(side: LaunchSide, point: GroundPoint): void {
    if (this.phase !== 'mounted' && this.phase !== 'armed') return;
    if (this.setup[side].driver.kind !== 'person') return;
    this.runtime[side].target = clampLaunchTarget(point, this.arena, side);
    if (!this.runtime[side].pressed) this.poses[side] = this.mountedPose(side);
  }

  /** A person pressing LAUNCH from outside the input record (a click on the button). Same rules as a press in `step`. */
  press(side: LaunchSide): void {
    if (this.phase !== 'armed') return;
    if (this.setup[side].driver.kind !== 'person') return;
    this.registerPress(side, this.currentMarker());
  }

  /** The marker as the player last saw it. */
  private currentMarker(): number {
    return markerAt(this.armedTicks * this.dt);
  }

  private mountedPose(side: LaunchSide): LaunchBeyPose {
    return { state: 'mounted', position: socketPosition(side, this.arena, this.runtime[side].target), flightProgress: 0, leanRad: 0 };
  }

  private registerPress(side: LaunchSide, marker: number): void {
    const r = this.runtime[side];
    if (r.pressed) return;
    r.pressed = true;
    r.quality = timingQuality(marker);
  }

  /** Advances one fixed tick. */
  step(inputs: LaunchInputs = {}): LaunchEvents {
    if (this.done) return { released: false, landed: [] };
    const events = { released: false, landed: [] as LaunchSide[] };
    this.tick++;
    const t = LAUNCH_TUNING;

    if (this.phase === 'mounted') {
      this.aimPeople(inputs);
      if (this.tick * this.dt >= t.introHoldS) {
        this.phase = 'armed';
        this.armedTicks = 0;
      }
    } else if (this.phase === 'armed') {
      const markerSeenByPlayer = this.currentMarker();
      this.aimPeople(inputs);
      for (const side of LAUNCH_SIDES) {
        if (this.setup[side].driver.kind === 'person' && inputs[side]?.press) this.registerPress(side, markerSeenByPlayer);
      }
      this.armedTicks++;
      const armedS = this.armedTicks * this.dt;
      const people = LAUNCH_SIDES.filter((s) => this.setup[s].driver.kind === 'person');
      const everyPersonPressed = people.length > 0 && people.every((s) => this.runtime[s].pressed);
      const nobodyToWaitFor = people.length === 0 && armedS >= t.autoReleaseAfterArmedS;
      const timedOut = armedS >= t.armedTimeoutS;
      if (everyPersonPressed || nobodyToWaitFor || timedOut) {
        // A person who let the window run out is released with the marker where it stands: no free perfect launch.
        for (const side of people) if (!this.runtime[side].pressed) this.registerPress(side, markerAt(armedS));
        this.release();
        events.released = true;
      }
    }

    if (this.phase === 'release' || this.phase === 'flight') {
      const sinceRelease = (this.tick - this.releaseTick) * this.dt;
      if (this.phase === 'release' && sinceRelease > t.releasePhaseS) this.phase = 'flight';
      let allLanded = true;
      for (const side of LAUNCH_SIDES) {
        const r = this.runtime[side];
        const plan = r.plan!;
        const elapsed = sinceRelease - r.delayS;
        if (elapsed >= plan.durationS) {
          if (!r.landed) {
            r.landed = true;
            events.landed.push(side);
          }
          this.poses[side] = { state: 'landed', position: plan.end, flightProgress: 1, leanRad: 0 };
        } else {
          allLanded = false;
          const pose = flightPose(plan, elapsed);
          this.poses[side] = elapsed <= 0 ? { state: 'mounted', position: plan.start, flightProgress: 0, leanRad: 0 } : { state: 'flying', position: pose.position, flightProgress: pose.progress, leanRad: pose.leanRad };
        }
      }
      if (allLanded) this.phase = 'landed';
    } else {
      for (const side of LAUNCH_SIDES) if (!this.runtime[side].pressed) this.poses[side] = this.mountedPose(side);
    }
    return events;
  }

  private aimPeople(inputs: LaunchInputs): void {
    for (const side of LAUNCH_SIDES) {
      const r = this.runtime[side];
      if (this.setup[side].driver.kind !== 'person' || r.pressed) continue;
      const aim = inputs[side]?.aim;
      if (!aim || (aim.x === 0 && aim.y === 0)) continue;
      const f = launcherForward(side);
      const right = launcherRight(side);
      const step = this.arena.floorRadiusM * LAUNCH_TUNING.targetMoveRadiiPerS * this.dt;
      r.target = clampLaunchTarget({ x: r.target.x + (f.x * aim.y + right.x * aim.x) * step, z: r.target.z + (f.z * aim.y + right.z * aim.x) * step }, this.arena, side);
      this.poses[side] = this.mountedPose(side);
    }
  }

  private release(): void {
    const result: LaunchResult = {
      first: { target: { ...this.runtime.first.target }, quality: this.qualityOf('first') },
      second: { target: { ...this.runtime.second.target }, quality: this.qualityOf('second') },
    };
    this.result = result;
    const arrivals = launchArrivals(result, this.arena, { first: this.setup.first.shape, second: this.setup.second.shape });
    for (const side of LAUNCH_SIDES) {
      const r = this.runtime[side];
      r.quality = result[side].quality;
      // It leaves from where it sits (the launcher stays turned to the point chosen); a yielding landing may end a little aside of it.
      r.plan = flightPlan(side, socketPosition(side, this.arena, r.target), arrivals[side].position, result[side].quality);
    }
    this.releaseTick = this.tick;
    this.phase = 'release';
  }

  private qualityOf(side: LaunchSide): number {
    const driver = this.setup[side].driver;
    if (driver.kind === 'plan') return launchOutcomeFor(driver.quality).quality;
    return this.runtime[side].quality ?? 0;
  }

  /** The marker, the entry points and the grades, for the HUD and the rigs. */
  getView(): LaunchView {
    const people = LAUNCH_SIDES.filter((s) => this.setup[s].driver.kind === 'person');
    const personSide = people[0] ?? 'first';
    const q = (side: LaunchSide): number | null => (this.result ? this.result[side].quality : this.runtime[side].quality);
    const mainQuality = q(personSide);
    return {
      phase: this.phase,
      elapsedS: this.tick * this.dt,
      armedS: this.armedTicks * this.dt,
      marker: this.phase === 'armed' || this.phase === 'mounted' ? this.currentMarker() : markerAt(this.armedTicks * this.dt),
      targets: { first: { ...this.runtime.first.target }, second: { ...this.runtime.second.target } },
      qualities: { first: q('first'), second: q('second') },
      pressed: { first: this.runtime.first.pressed, second: this.runtime.second.pressed },
      grade: this.result && mainQuality !== null ? launchGrade(mainQuality) : null,
      waitingForPerson: people.length > 0 && (this.phase === 'mounted' || this.phase === 'armed') && people.some((s) => !this.runtime[s].pressed),
      done: this.done,
    };
  }

  /** The plan of a side's flight (its start, its end, its arc), once released: the presentation draws trails and bursts from it. */
  getFlightPlan(side: LaunchSide): FlightPlan | null {
    return this.runtime[side].plan;
  }

  /** Where a side's launcher is aimed and its arc guide, before the release: the prototype's dashed guide. */
  getTarget(side: LaunchSide): GroundPoint {
    return this.runtime[side].target;
  }
}
