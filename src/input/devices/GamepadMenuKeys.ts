// ============================================================
// GAMEPAD MENU KEYS (M10)
// Lets a pad drive the menus: while running, it polls the first pad each
// frame and replays D-pad/stick/A/B as the keyboard keys the screens
// already handle (arrows, Enter, Escape), with key-repeat on a held
// direction. When no screen handles a key, it falls back to moving focus
// between the visible buttons and clicking the focused one, so plain DOM
// menus (the Main Menu) work too. Off during a match: the match reads the
// pad through GamepadController.
// ============================================================

import { currentGamepads, gamepadMenuKeys, readFirstGamepad, type MenuKeyCode } from './gamepadMapping';

const REPEAT_DELAY_MS = 380;
const REPEAT_INTERVAL_MS = 120;
const REPEATING: ReadonlySet<MenuKeyCode> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class GamepadMenuKeys {
  private rafHandle: number | null = null;
  private readonly downSince = new Map<MenuKeyCode, number>();
  private readonly lastFired = new Map<MenuKeyCode, number>();
  /** Keys held when started (e.g. the A that confirmed the last screen) fire only after a release. */
  private readonly ignoreUntilReleased = new Set<MenuKeyCode>();

  constructor(private readonly readPads: () => readonly (Gamepad | null)[] = currentGamepads) {}

  start(): void {
    if (this.rafHandle !== null) return;
    const pad = readFirstGamepad(this.readPads());
    this.ignoreUntilReleased.clear();
    if (pad) gamepadMenuKeys(pad.snapshot).forEach((k) => this.ignoreUntilReleased.add(k));
    this.downSince.clear();
    this.lastFired.clear();
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  private readonly frame = (nowMs: number): void => {
    const pad = readFirstGamepad(this.readPads());
    const keys = pad ? gamepadMenuKeys(pad.snapshot) : new Set<MenuKeyCode>();
    for (const key of [...this.ignoreUntilReleased]) if (!keys.has(key)) this.ignoreUntilReleased.delete(key);
    for (const key of [...this.downSince.keys()]) if (!keys.has(key)) this.downSince.delete(key);
    for (const key of keys) {
      if (this.ignoreUntilReleased.has(key)) continue;
      const since = this.downSince.get(key);
      if (since === undefined) {
        this.downSince.set(key, nowMs);
        this.lastFired.set(key, nowMs);
        pressMenuKey(key);
      } else if (REPEATING.has(key) && nowMs - since >= REPEAT_DELAY_MS && nowMs - (this.lastFired.get(key) ?? 0) >= REPEAT_INTERVAL_MS) {
        this.lastFired.set(key, nowMs);
        pressMenuKey(key);
      }
    }
    if (this.rafHandle !== null) this.rafHandle = requestAnimationFrame(this.frame);
  };
}

/** One menu key press: to the screens first, then the plain-DOM fallback. */
export function pressMenuKey(code: MenuKeyCode): void {
  const event = new KeyboardEvent('keydown', { code, key: code === 'Escape' ? 'Escape' : code === 'Enter' ? 'Enter' : code, bubbles: true, cancelable: true });
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  target.dispatchEvent(event);
  if (event.defaultPrevented) return;
  if (code === 'Enter') {
    if (target instanceof HTMLButtonElement || target instanceof HTMLElement && target.tagName === 'SUMMARY') target.click();
    return;
  }
  if (code === 'ArrowUp' || code === 'ArrowLeft') moveFocus(-1);
  else if (code === 'ArrowDown' || code === 'ArrowRight') moveFocus(1);
}

function moveFocus(delta: number): void {
  const buttons = [...document.querySelectorAll<HTMLElement>('button, summary, input, select')].filter((node) => node.offsetParent !== null && !(node as HTMLButtonElement).disabled);
  if (buttons.length === 0) return;
  const index = buttons.indexOf(document.activeElement as HTMLElement);
  const next = index === -1 ? 0 : (index + delta + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
