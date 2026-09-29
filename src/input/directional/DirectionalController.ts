// ============================================================
// DIRECTIONAL CONTROLLER (M11 — default control scheme)
// Wraps the player's device controller (keyboard + gamepad). The arrows,
// D-pad and stick stop meaning "turn / throttle" and mean "go this way on
// the screen": ↑ up the screen, ↓ down, ←/→ sideways, diagonals
// normalized, the stick continuous in direction and strength. The screen
// direction becomes a world X/Z direction with the camera yaw latched for
// the gesture (CameraYawLatch), and that resolved direction is what goes
// into ControllerActions.moveIntent and the replay. How the Bey gets
// there — turn rate, momentum, grip, drift — stays physics
// (MovementController).
//
// The Classic setting turns this wrapper off (setEnabled(false)): the
// device actions go through unchanged (tank steering).
// ============================================================

import { Action, type CombatController, type ControllerActions, type ControllerContext, type MoveIntent } from '../actions/Action';
import { CameraYawLatch, cameraYawFromRight, screenLength, screenVectorFromDigital, screenVectorFromStick, ZERO_SCREEN, type ScreenVector } from './screenDirection';

/** The four actions directional mode reads as screen directions (never held in its output). */
const DIRECTION_ACTIONS: readonly Action[] = [Action.MoveForward, Action.MoveBackward, Action.SteerLeft, Action.SteerRight];

export interface DirectionalSources {
  /** Current camera yaw (fromYaw convention), read only when a gesture starts. */
  readonly cameraYaw: () => number;
  /** Left stick [x, y] (y down), or null without a pad. */
  readonly stick?: () => readonly [number, number] | null;
}

/** What the player asked for on the last sample (Debug Lab / F3 only). */
export interface DirectionalDebug {
  readonly screen: ScreenVector;
  readonly world: MoveIntent;
}

export class DirectionalController implements CombatController {
  private readonly latch = new CameraYawLatch();
  private last: DirectionalDebug = { screen: ZERO_SCREEN, world: { x: 0, z: 0 } };
  private enabled = true;

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
    const world = this.latch.resolve(screen, this.sources.cameraYaw());
    this.last = { screen, world };
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

  /** The last sampled screen and world direction (read-only, for the debug overlay). */
  getDebug(): DirectionalDebug {
    return this.last;
  }

  /** Forget the latched camera (pause/resume). */
  reset(): void {
    this.latch.reset();
    this.last = { screen: ZERO_SCREEN, world: { x: 0, z: 0 } };
  }
}

/** Yaw (fromYaw convention) of a Three.js camera, from its world matrix's right axis. */
export function cameraYawOf(camera: { readonly matrixWorld: { readonly elements: ArrayLike<number> } }): number {
  const e = camera.matrixWorld.elements;
  return cameraYawFromRight(e[0]!, e[2]!);
}
