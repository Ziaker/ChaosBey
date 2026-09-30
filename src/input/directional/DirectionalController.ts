// ============================================================
// DIRECTIONAL CONTROLLER (M11 — arena/world-relative, now an
// experimental/debug option; see screenDirection.ts's header and
// PlayerSettings.ts for why Classic/Bey-relative is the player default)
// Wraps the player's device controller (keyboard + gamepad). The arrows,
// D-pad and stick mean "go this way in the arena": ↑ = world +Z, ↓ = world
// −Z, ←/→ = world ∓X/±X, diagonals normalized, the stick continuous in
// direction and strength. That resolved WORLD direction — fixed, never the
// camera's — is what goes into ControllerActions.moveIntent and the
// replay. How the Bey gets there — turn rate, momentum, grip, drift —
// stays physics (MovementController).
//
// This class has no camera dependency whatsoever — not even for
// diagnostics. There used to be one (a `cameraYaw` source, read only to
// show a side-by-side F3/Debug Lab readout, never fed into the
// computation above), removed by owner decision (2026-09-30, "Fix 6" of
// this playtest round): src/input/ must not know the camera exists at
// all, full stop, so the boundary can be enforced structurally (see the
// architectural regression-guard test) instead of by a "diagnostic only"
// comment. The camera's own yaw is now read directly by the debug
// overlay/inspector from MatchSession.getLastCameraOutput().yawDeg, never
// through this controller.
//
// The Classic setting turns this wrapper off (setEnabled(false)): the
// device actions go through unchanged (tank steering) — and is now the
// player's default control scheme.
// ============================================================

import { Action, type CombatController, type ControllerActions, type ControllerContext, type MoveIntent } from '../actions/Action';
import { screenLength, screenToWorld, screenVectorFromDigital, screenVectorFromStick, ZERO_SCREEN, type ScreenVector } from './screenDirection';

/** The four actions directional mode reads as screen directions (never held in its output). */
const DIRECTION_ACTIONS: readonly Action[] = [Action.MoveForward, Action.MoveBackward, Action.SteerLeft, Action.SteerRight];

export interface DirectionalSources {
  /** Left stick [x, y] (y down), or null without a pad. */
  readonly stick?: () => readonly [number, number] | null;
}

/** What the player asked for on the last sample (Debug Lab / F3 only). */
export interface DirectionalDebug {
  readonly screen: ScreenVector;
  readonly world: MoveIntent;
}

export class DirectionalController implements CombatController {
  private last: DirectionalDebug = { screen: ZERO_SCREEN, world: { x: 0, z: 0 } };
  private enabled = true;

  constructor(
    private readonly inner: CombatController,
    private readonly sources: DirectionalSources = {},
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
    const world = screenToWorld(screen);
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

  /** The last sampled screen and world direction — for the debug overlay. */
  getDebug(): DirectionalDebug {
    return this.last;
  }

  reset(): void {
    this.last = { screen: ZERO_SCREEN, world: { x: 0, z: 0 } };
  }
}
