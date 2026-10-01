// ============================================================
// DIRECTIONAL CONTROLLER (M11 — the player default again, "Fix 7" of this
// playtest round, 2026-10-01, amended by "Fix 9" below; see
// screenDirection.ts's header for the full history of why)
// Wraps the player's device controller (keyboard + gamepad). The arrows,
// D-pad and stick mean "go this way on the screen": ↑ away from the
// camera, ↓ toward it, ←/→ the camera's left/right, diagonals normalized,
// the stick continuous in direction and strength. That resolved WORLD
// direction — recomputed fresh from the camera's CURRENT yaw on every
// single tick, no memory of any previous tick — is what goes into
// ControllerActions.moveIntent and the replay. "Fix 9" (owner playtest,
// 2026-10-01: "a câmera move o bey sozinho — só o jogador move o jogador"):
// the camera yaw is read ONCE, on the tick the player starts to move, and
// stays frozen until every direction is released. The automatic camera
// orbiting while a key is held therefore never bends the Bey's path — only
// the player's own input does. (Unlike the original CameraYawLatch there is
// no mid-hold re-read boundary: adding/changing a direction while still
// holding keeps the same frame.) How the Bey gets there —
// turn rate, momentum, grip, drift — stays physics (MovementController).
//
// The camera reaches this class only as a plain number (radians) returned
// by a caller-supplied function — never a Camera/CameraRig type or a
// src/camera/ import. That keeps the architectural boundary intact (an
// import-scanning regression-guard test, inputCameraBoundary.test.ts,
// still asserts src/input/ never imports from src/camera/): the dependency
// is a single float handed in by whoever wires this controller up
// (MatchRunner.ts, DebugLabMode.ts — both read it from
// MatchSession.getLastCameraOutput().yawDeg, the same deterministic,
// tick-synchronized value the debug overlay/inspector already read
// directly, bypassing this controller, for diagnostics).
//
// The Classic setting turns this wrapper off (setEnabled(false)): the
// device actions go through unchanged (tank steering, Bey-relative,
// genuinely camera-free) for a player who prefers it.
// ============================================================

import { Action, type CombatController, type ControllerActions, type ControllerContext, type MoveIntent } from '../actions/Action';
import { screenLength, screenToWorld, screenVectorFromDigital, screenVectorFromStick, ZERO_SCREEN, type ScreenVector } from './screenDirection';

/** The four actions directional mode reads as screen directions (never held in its output). */
const DIRECTION_ACTIONS: readonly Action[] = [Action.MoveForward, Action.MoveBackward, Action.SteerLeft, Action.SteerRight];

export interface DirectionalSources {
  /** The camera's current yaw (fromYaw convention, radians) — read fresh every tick, no latching. */
  readonly cameraYaw: () => number;
  /** Left stick [x, y] (y down), or null without a pad. */
  readonly stick?: () => readonly [number, number] | null;
}

/** What the player asked for on the last sample (Debug Lab / F3 only). */
export interface DirectionalDebug {
  readonly screen: ScreenVector;
  readonly world: MoveIntent;
  readonly cameraYawRad: number;
}

export class DirectionalController implements CombatController {
  private last: DirectionalDebug = { screen: ZERO_SCREEN, world: { x: 0, z: 0 }, cameraYawRad: 0 };
  private enabled = true;
  /** Camera yaw frozen for the current gesture; null while nothing is held. */
  private gestureYaw: number | null = null;

  constructor(
    private readonly inner: CombatController,
    private readonly sources: DirectionalSources,
  ) {}

  sampleActions(context: ControllerContext): ControllerActions {
    const actions = this.inner.sampleActions(context);
    if (!this.enabled) return actions;
    const stickAxes = this.sources.stick?.() ?? null;
    const stick = stickAxes ? screenVectorFromStick(stickAxes[0], stickAxes[1]) : ZERO_SCREEN;
    const screen =
      screenLength(stick) > 0
        ? stick
        : screenVectorFromDigital(
            actions.held.has(Action.MoveForward),
            actions.held.has(Action.MoveBackward),
            actions.held.has(Action.SteerLeft),
            actions.held.has(Action.SteerRight),
          );
    if (screenLength(screen) === 0) this.gestureYaw = null;
    else if (this.gestureYaw === null) this.gestureYaw = this.sources.cameraYaw();
    const cameraYawRad = this.gestureYaw ?? 0;
    const world = screenToWorld(screen, cameraYawRad);
    this.last = { screen, world, cameraYawRad };
    const held = new Set(actions.held);
    const pressedThisFrame = new Set(actions.pressedThisFrame);
    for (const action of DIRECTION_ACTIONS) {
      held.delete(action);
      pressedThisFrame.delete(action);
    }
    return { ...actions, held, pressedThisFrame, moveIntent: world };
  }

  /** Off = the Classic control setting: the device actions pass through unchanged. Takes effect on the next sample. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.reset();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** The last sampled screen, world direction and camera yaw — for the debug overlay. */
  getDebug(): DirectionalDebug {
    return this.last;
  }

  reset(): void {
    this.gestureYaw = null;
    this.last = { screen: ZERO_SCREEN, world: { x: 0, z: 0 }, cameraYawRad: 0 };
  }
}
