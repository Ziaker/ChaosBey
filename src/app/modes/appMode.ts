// ============================================================
// APP MODE ROUTING
// Which top-level mode the page boots into, from the URL query `mode`.
// No `mode` (the plain game URL) opens the Main Menu. Unknown values also
// fall back to the Main Menu, so an old or mistyped link still lands on
// the game's front door.
// ============================================================

export type AppMode = 'menu' | 'play' | 'settings' | 'debug-lab' | 'self-test';

const LINKED_MODES: readonly AppMode[] = ['play', 'settings', 'debug-lab', 'self-test'];

export function resolveAppMode(search: string): AppMode {
  const mode = new URLSearchParams(search).get('mode');
  return LINKED_MODES.find((m) => m === mode) ?? 'menu';
}

/**
 * The URL that boots `mode`, relative to the current page: same path, only
 * the `mode` query changed (the Main Menu is the URL without it). Every
 * mode — from the menu or a typed link — boots through this one route.
 */
export function appModeHref(mode: AppMode, current: { readonly pathname: string; readonly search: string }): string {
  const params = new URLSearchParams(current.search);
  if (mode === 'menu') params.delete('mode');
  else params.set('mode', mode);
  const query = params.toString();
  return query ? `${current.pathname}?${query}` : current.pathname;
}

/** `?mode=play&quick`: start the default match directly, skipping the player screens. */
export function isQuickPlay(search: string): boolean {
  return new URLSearchParams(search).has('quick');
}
