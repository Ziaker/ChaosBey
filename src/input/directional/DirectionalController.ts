// ============================================================
// DIRECTIONAL CONTROLLER (M11 — the player default)
// Wraps the player's device controller (keyboard + gamepad). The arrows,
// D-pad and stick mean "go this way relative to the control reference":
// ↑ forward along the reference, ↓ back, ←/→ its left/right, diagonals
// normalized, the stick continuous in direction and strength. That
// resolved WORLD direction is what goes into ControllerActions.moveIntent
// and the replay. How the Bey gets there — turn rate, momentum, grip,
// drift — stays physics (MovementController).
//
// THE REFERENCE IS GAMEPLAY-OWNED, NEVER THE CAMERA (owner requirement,
// 2026-10-01: "A CÂMERA NUNCA MOVE O BEY"; the single opt-in exception, the
// 'screen' scheme, is wired outside src/input/). The only external input this
// class accepts besides the device is a ControlReference (see
// ControlReference.ts) — there is deliberately no `cameraYaw` callback,
// no number that could carry camera output, and no camera type or import
// anywhere under src/input/ (enforced by tests/unit/inputCameraBoundary
// .test.ts, which also forbids the word in this directory's code):
//
//   Camera is downstream presentation. It may observe gameplay; it may
//   never mutate or causally influence gameplay.
//
// The Classic setting turns this wrapper off (setEnabled(false)): the
// device actions go through unchanged (tank steering, Bey-relative).
// ============================================================

import { Action, type CombatController, type ControllerActions, type ControllerContext, type MoveIntent } from '../actions/Action';
import { WORLD_CONTROL_REFERENCE, type ControlReference } from './ControlReference';
import { screenLength, screenToWorld, screenVectorFromDigital, screenVectorFromStick, ZERO_SCREEN, type ScreenVector } from './screenDirection';

/** The four actions directional mode reads as directions (never held in its output). */
// SteerLeft/SteerRight stay held: they are the screen's lateral input, which the drift rule reads (owner, 2026-10-02).
// Nothing else reads them while a moveIntent is present (movement and dodge use the intent).
const DIRECTION_ACTIONS: readonly Action[] = [Action.MoveForward, Action.MoveBackward];

export interface DirectionalSources {
  /** The gameplay-owned frame the arrows are resolved in. Defaults to the fixed arena frame. */
  readonly reference?: ControlReference;
  /** Left stick [x, y] (y down), or null without a pad. */
  readonly stick?: () => readonly [number, number] | null;
}

/** What the player asked for on the last sample (Debug Lab / F3 only). */
export interface DirectionalDebug {
  readonly screen: ScreenVector;
  readonly world: MoveIntent;
  /** The control reference's yaw used for this sample. */
  readonly referenceYawRad: number;
}

export class DirectionalController implements CombatController {
  private last: DirectionalDebug = { screen: ZERO_SCREEN, world: { x: 0, z: 0 }, referenceYawRad: 0 };
  private enabled = true;
  private reference: ControlReference;

  constructor(
    private readonly inner: CombatController,
    private readonly sources: DirectionalSources = {},
  ) {
    this.reference = sources.reference ?? WORLD_CONTROL_REFERENCE;
  }

  /** Swaps the frame of reference live (control scheme changed in Settings). Takes effect on the next sample. */
  setReference(reference: ControlReference): void {
    this.reference = reference;
    this.reset();
  }

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
    const referenceYawRad = this.reference.yawRad(screenLength(screen) > 0);
    const world = screenToWorld(screen, referenceYawRad);
    this.last = { screen, world, referenceYawRad };
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

  /** Which frame of reference the arrows are resolved in (debug overlay). */
  getReferenceKind(): ControlReference['kind'] {
    return this.reference.kind;
  }

  /** The last sampled direction, world direction and reference yaw — for the debug overlay. */
  getDebug(): DirectionalDebug {
    return this.last;
  }

  reset(): void {
    this.last = { screen: ZERO_SCREEN, world: { x: 0, z: 0 }, referenceYawRad: 0 };
  }
}
