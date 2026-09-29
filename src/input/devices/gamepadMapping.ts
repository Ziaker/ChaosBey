// ============================================================
// GAMEPAD MAPPING (M10, GDD 14: gameplay consumes actions, never raw
// buttons). The standard-layout gamepad (W3C "standard" mapping) mirrors
// the keyboard scheme: stick or D-pad to steer and move, face buttons for
// the three combat actions, Start to pause. Pure: a snapshot of buttons
// and axes in, the held actions out, so it is unit-testable without a
// browser.
// ============================================================

import { Action } from '../actions/Action';

/** W3C standard gamepad button indices. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
} as const;

/** Stick travel before a direction counts as held. */
export const STICK_DEADZONE = 0.4;
/** Trigger travel before it counts as pressed. */
export const TRIGGER_THRESHOLD = 0.3;

export interface GamepadSnapshot {
  /** Pressed state or analog value (0..1) per button index. */
  readonly buttons: readonly number[];
  /** Axes, -1..1: [left X, left Y, right X, right Y]. */
  readonly axes: readonly number[];
}

/** Every binding, for the Settings controls table. */
export const GAMEPAD_BINDINGS: readonly { readonly action: Action; readonly label: string; readonly buttons: string }[] = [
  { action: Action.SteerLeft, label: 'Steer', buttons: 'Left stick ← → / D-pad ← →' },
  { action: Action.MoveForward, label: 'Forward / back', buttons: 'Left stick ↑ ↓ / D-pad ↑ ↓ / RT, LT' },
  { action: Action.Attack, label: 'Attack (hold to charge a Dash)', buttons: 'A' },
  { action: Action.JumpDrift, label: 'Hop / jump / drift', buttons: 'X or LB' },
  { action: Action.Dodge, label: 'Dodge', buttons: 'B or RB' },
  { action: Action.Pause, label: 'Pause', buttons: 'Start' },
];

const pressed = (snapshot: GamepadSnapshot, index: number, threshold = 0.5): boolean => (snapshot.buttons[index] ?? 0) >= threshold;

export function gamepadHeldActions(snapshot: GamepadSnapshot): Set<Action> {
  const held = new Set<Action>();
  const x = snapshot.axes[0] ?? 0;
  const y = snapshot.axes[1] ?? 0;
  if (x <= -STICK_DEADZONE || pressed(snapshot, PAD.Left)) held.add(Action.SteerLeft);
  if (x >= STICK_DEADZONE || pressed(snapshot, PAD.Right)) held.add(Action.SteerRight);
  if (y <= -STICK_DEADZONE || pressed(snapshot, PAD.Up) || pressed(snapshot, PAD.RT, TRIGGER_THRESHOLD)) held.add(Action.MoveForward);
  if (y >= STICK_DEADZONE || pressed(snapshot, PAD.Down) || pressed(snapshot, PAD.LT, TRIGGER_THRESHOLD)) held.add(Action.MoveBackward);
  if (pressed(snapshot, PAD.A)) held.add(Action.Attack);
  if (pressed(snapshot, PAD.X) || pressed(snapshot, PAD.LB)) held.add(Action.JumpDrift);
  if (pressed(snapshot, PAD.B) || pressed(snapshot, PAD.RB)) held.add(Action.Dodge);
  if (pressed(snapshot, PAD.Start)) held.add(Action.Pause);
  return held;
}

/** Menu navigation from a pad, as the keyboard codes the screens already handle. */
export type MenuKeyCode = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter' | 'Escape';

export function gamepadMenuKeys(snapshot: GamepadSnapshot): Set<MenuKeyCode> {
  const keys = new Set<MenuKeyCode>();
  const x = snapshot.axes[0] ?? 0;
  const y = snapshot.axes[1] ?? 0;
  if (y <= -STICK_DEADZONE || pressed(snapshot, PAD.Up)) keys.add('ArrowUp');
  if (y >= STICK_DEADZONE || pressed(snapshot, PAD.Down)) keys.add('ArrowDown');
  if (x <= -STICK_DEADZONE || pressed(snapshot, PAD.Left)) keys.add('ArrowLeft');
  if (x >= STICK_DEADZONE || pressed(snapshot, PAD.Right)) keys.add('ArrowRight');
  if (pressed(snapshot, PAD.A) || pressed(snapshot, PAD.Start)) keys.add('Enter');
  if (pressed(snapshot, PAD.B) || pressed(snapshot, PAD.Back)) keys.add('Escape');
  return keys;
}

/** The first connected pad, as a plain snapshot (null when none). */
export function readFirstGamepad(pads: readonly (Gamepad | null)[] | null | undefined): { readonly id: string; readonly snapshot: GamepadSnapshot } | null {
  for (const pad of pads ?? []) {
    if (!pad || !pad.connected) continue;
    return { id: pad.id, snapshot: { buttons: pad.buttons.map((b) => (b.pressed ? Math.max(1, b.value) : b.value)), axes: [...pad.axes] } };
  }
  return null;
}

/** navigator.getGamepads(), or [] where the API is missing or throws (insecure context, old browser). */
export function currentGamepads(): readonly (Gamepad | null)[] {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  } catch {
    return [];
  }
}
