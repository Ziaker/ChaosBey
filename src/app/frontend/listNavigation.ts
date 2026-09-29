// ============================================================
// LIST NAVIGATION — MENU KEYS TO A MOVE (M10)
// The player-facing screens share one small set of navigation keys, so
// keyboard and gamepad (which feeds the same codes, see
// input/devices/GamepadMenuKeys.ts) behave the same everywhere.
// ============================================================

export type NavigationIntent = 'previous' | 'next' | 'decrease' | 'increase' | 'confirm' | 'back';

const KEY_INTENTS: Readonly<Record<string, NavigationIntent>> = {
  ArrowUp: 'previous',
  ArrowDown: 'next',
  ArrowLeft: 'decrease',
  ArrowRight: 'increase',
  Enter: 'confirm',
  Space: 'confirm',
  KeyZ: 'confirm',
  Escape: 'back',
  Backspace: 'back',
};

/** The navigation meaning of a KeyboardEvent.code, or null. */
export function navigationIntent(code: string): NavigationIntent | null {
  return KEY_INTENTS[code] ?? null;
}

/** Moves a focus index by `delta`, wrapping around a list of `length` items. */
export function wrapIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((index + delta) % length) + length) % length;
}
