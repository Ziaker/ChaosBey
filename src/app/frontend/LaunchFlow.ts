// ============================================================
// LAUNCH FLOW — the round start of the player flow (Launch System A — Timing Snap)
// Runs the launch before the match's first tick, on the same fixed tick as the match: reads the person's input (the entry
// point, LAUNCH), steps the deterministic LaunchSequence, poses the Beys in their launchers and in the air, and draws the rig,
// the HUD and the camera. When the last Bey touches down it hands the LaunchResult to the session, which starts the match on
// the very next tick: no countdown, no hold, no input lock (design doc §2, §10).
//
// Nothing here is simulation: the session sees only the result (replayable, §9); the poses it is given before that are
// presentation. The AI plans its side with a random stream of its own, so the launch moves no other random draw.
// ============================================================

import * as THREE from 'three';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../ai/difficulty/AiDifficultyProfile';
import { aiDifficultyTier } from '../../ai/difficulty/AiDifficultyTiers';
import { LaunchCamera, type LaunchShot } from '../../camera/launch/LaunchCamera';
import { Action, type ControllerActions } from '../../input/actions/Action';
import { launchArenaOf, launchShapeOf } from '../../launch/applyLaunchArrival';
import { planAiLaunch } from '../../launch/LaunchAiPolicy';
import { defaultLaunchTarget, launcherForward, launcherRight } from '../../launch/LaunchGeometry';
import type { LaunchResult } from '../../launch/LaunchResult';
import { LaunchSequence, type LaunchDriver } from '../../launch/LaunchSequence';
import { LAUNCH_SIDES, LAUNCH_TUNING, launchOutcomeFor, type LaunchSide } from '../../launch/LaunchTuning';
import { LaunchRig } from '../../presentation/launchRig';
import { SeededRng } from '../../rng/SeededRng';
import { normalizeSeedText } from '../../rng/stringSeed';
import type { BeyVisualPose } from '../bootstrap/createMatchScene';
import type { MatchSession } from '../session/MatchSession';
import { resolveAiPersonality } from '../session/SideControllers';
import { LaunchHud } from './LaunchHud';

/** A stream of its own, derived from the match seed, for the AI's launch decisions. */
const LAUNCH_RNG_SALT = 0x165667b1;
/** Quality an idle / scripted side launches with: a clean, unremarkable release (the prototype's neutral launch). */
const NEUTRAL_QUALITY = 0.8;
/** Visual spin (rad/s) of a Bey: mounted, and launched by quality (render only; the prototype's). */
const LAUNCHED_SPIN_BASE_RAD_S = 22;
const LAUNCHED_SPIN_QUALITY_RAD_S = 40;
const OTHER_SIDE_SPIN_RAD_S = 48;

export interface LaunchInput {
  /** What the person pressed this tick (for Pause and the debug toggles; LAUNCH is read from it). */
  readonly actions: ControllerActions;
  /** The arrows / stick as a screen vector (x right, y up, length 0..1), whatever the control scheme. */
  readonly aim: { readonly x: number; readonly y: number };
}

export interface LaunchFlowDeps {
  readonly session: MatchSession;
  /** The render camera, for turning a click on the arena into an entry point. */
  readonly camera: THREE.PerspectiveCamera;
  /** The element clicks on the arena arrive on (the renderer's canvas). */
  readonly canvas: HTMLElement;
  /** Where the HUD goes. */
  readonly mount: HTMLElement;
  /** Each Bey's color (CSS), for the launcher rails and the guide. */
  readonly accentsCss: { readonly first: string; readonly second: string };
  /** Reads the person's input once per fixed tick. */
  readonly sampleInput: () => LaunchInput;
}

/** The drivers of a launch for this match's sides: a person where the keyboard/pad plays, the AI's plan where an AI does. */
export function launchDriversFor(session: MatchSession): Record<LaunchSide, LaunchDriver> {
  const arena = launchArenaOf(session.getBey('first').arenaFloor);
  const { seedUint32 } = normalizeSeedText(session.seedText);
  const rng = SeededRng.fromSeedUint32((seedUint32 ^ LAUNCH_RNG_SALT) >>> 0);
  const driverFor = (side: LaunchSide): LaunchDriver => {
    const spec = session.getControllerSpec(side);
    if (spec.kind === 'keyboard') return { kind: 'person' };
    if (spec.kind === 'ai') {
      const personality = resolveAiPersonality(spec.personality, session.getBey(side));
      const difficulty = spec.difficulty ? aiDifficultyTier(spec.difficulty).profile : DEFAULT_AI_DIFFICULTY_PROFILE;
      const plan = planAiLaunch(side, arena, rng, personality, difficulty);
      return { kind: 'plan', target: plan.target, quality: plan.quality };
    }
    return { kind: 'plan', target: defaultLaunchTarget(side, arena), quality: NEUTRAL_QUALITY };
  };
  // `first` is always planned before `second`: the order of the draws is part of the match.
  const first = driverFor('first');
  const second = driverFor('second');
  return { first, second };
}

export class LaunchFlow {
  readonly sequence: LaunchSequence;
  readonly camera: LaunchCamera;
  private readonly rig: LaunchRig;
  private readonly hud: LaunchHud;
  private readonly people: LaunchSide[];
  private readonly spin: Record<LaunchSide, number> = { first: 0, second: 0 };
  private released = false;
  private disposed = false;
  private dragging = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly listeners: Array<[string, (e: PointerEvent) => void]> = [];
  private lastActions: ControllerActions | null = null;
  private pendingPress = false;

  constructor(private readonly deps: LaunchFlowDeps) {
    const { session } = deps;
    const arena = launchArenaOf(session.getBey('first').arenaFloor);
    const drivers = launchDriversFor(session);
    this.sequence = new LaunchSequence({
      arena,
      sides: {
        first: { driver: drivers.first, shape: launchShapeOf(session.getBey('first')) },
        second: { driver: drivers.second, shape: launchShapeOf(session.getBey('second')) },
      },
    });
    this.people = LAUNCH_SIDES.filter((s) => drivers[s].kind === 'person');
    this.rig = new LaunchRig(session.getSceneRoot(), arena, { first: deps.accentsCss.first, second: deps.accentsCss.second });
    const cameraSide: LaunchSide = this.people[0] ?? 'first';
    this.camera = new LaunchCamera(() => this.shotFor(cameraSide));
    this.hud = new LaunchHud(deps.mount, {
      accentCss: this.people[0] === 'second' ? deps.accentsCss.second : deps.accentsCss.first,
      onLaunch: () => {
        this.pendingPress = true;
      },
      onCenter: () => {
        const side = this.people[0];
        if (side) this.sequence.setTarget(side, defaultLaunchTarget(side, arena));
      },
    });
    this.bindPointer();
    this.poseBeys(0);
  }

  get finished(): boolean {
    return this.sequence.done;
  }

  /** The launch as the camera needs it, as plain numbers (the camera imports nothing of the launch). */
  private shotFor(side: LaunchSide): LaunchShot {
    const seq = this.sequence;
    const other: LaunchSide = side === 'first' ? 'second' : 'first';
    const plan = seq.getFlightPlan(side);
    const result = seq.getResult();
    return {
      phase: seq.currentPhase,
      own: seq.getPose(side).position,
      other: seq.getPose(other).position,
      forward: launcherForward(side),
      right: launcherRight(side),
      travel: plan ? { x: plan.end.x - plan.start.x, z: plan.end.z - plan.start.z } : null,
      power: result ? launchOutcomeFor(result[side].quality).power : 0,
    };
  }

  /** True while a person still has to decide something: the match must not time out their launch for them. */
  get waitingForPerson(): boolean {
    return this.sequence.getView().waitingForPerson;
  }

  getResult(): LaunchResult {
    const result = this.sequence.getResult();
    if (!result) throw new Error('LaunchFlow.getResult(): the launch has not been released.');
    return result;
  }

  getLastActions(): ControllerActions | null {
    return this.lastActions;
  }

  /** One fixed tick. Returns what the person's controller gave this tick (Pause, debug toggles). */
  tick(): ControllerActions {
    const input = this.deps.sampleInput();
    this.lastActions = input.actions;
    const person = this.people[0];
    const press = this.pendingPress || input.actions.pressedThisFrame.has(Action.Attack) || input.actions.pressedThisFrame.has(Action.JumpDrift);
    this.pendingPress = false;
    const inputs = person ? { [person]: { aim: input.aim, press } } : {};
    const events = this.sequence.step(inputs);
    if (events.released) {
      this.released = true;
      this.rig.onRelease(this.sequence);
    }
    this.poseBeys(0);
    return input.actions;
  }

  /** Once per rendered frame: the Beys' spin, the rig, the HUD. */
  frame(dt: number): void {
    if (this.disposed) return;
    const view = this.sequence.getView();
    this.poseBeys(dt);
    this.rig.update(dt, view, this.sequence, this.people);
    this.hud.update(dt, view);
  }

  private poseBeys(dt: number): void {
    const result = this.sequence.getResult();
    for (const side of LAUNCH_SIDES) {
      const pose = this.sequence.getPose(side);
      const launched = this.released && pose.state !== 'mounted';
      const rate = launched ? (side === 'first' && result ? LAUNCHED_SPIN_BASE_RAD_S + result.first.quality * LAUNCHED_SPIN_QUALITY_RAD_S : OTHER_SIDE_SPIN_RAD_S) : LAUNCH_TUNING.mountedSpinRadPerS;
      this.spin[side] += rate * dt;
      const visual: BeyVisualPose = { spin: this.spin[side], wobble: 0, lean: { x: 0, z: 0 } };
      this.deps.session.setLaunchPose(side, pose.position, visual);
    }
  }

  // ---- clicking or dragging on the arena places the entry point (the prototype's direct selection) ----

  private bindPointer(): void {
    const person = this.people[0];
    if (!person) return;
    const set = (event: PointerEvent): void => {
      const view = this.sequence.getView();
      if (view.phase !== 'mounted' && view.phase !== 'armed') return;
      const rect = this.deps.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
      this.deps.camera.updateMatrixWorld(true);
      this.raycaster.setFromCamera(ndc, this.deps.camera);
      const ray = this.raycaster.ray;
      const heightAbove = (t: number): number => {
        const p = ray.at(t, new THREE.Vector3());
        return p.y - (this.deps.session.floorHeightAt(p.x, p.z) + 0.12);
      };
      let lo = 0;
      let hi = 220;
      let flo = heightAbove(lo);
      const fhi = heightAbove(hi);
      if (flo * fhi > 0) return; // the click missed the floor
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        const fm = heightAbove(mid);
        if (flo * fm <= 0) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      const p = ray.at((lo + hi) / 2, new THREE.Vector3());
      this.sequence.setTarget(person, { x: p.x, z: p.z });
    };
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      this.dragging = true;
      set(e);
    };
    const move = (e: PointerEvent): void => {
      if (this.dragging) set(e);
    };
    const up = (): void => {
      this.dragging = false;
    };
    for (const [name, fn] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up]] as const) {
      this.deps.canvas.addEventListener(name, fn as EventListener);
      this.listeners.push([name, fn]);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [name, fn] of this.listeners) this.deps.canvas.removeEventListener(name, fn as EventListener);
    this.listeners.length = 0;
    this.rig.dispose();
    this.hud.dispose();
    this.camera.dispose();
  }
}
