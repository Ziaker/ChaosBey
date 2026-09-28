// ============================================================
// APP MODE ROUTING
// Which top-level mode the page boots into, from the URL query `mode`.
// Unknown values fall back to the normal match, so an old or mistyped link
// still opens the game.
// ============================================================

export type AppMode = 'play' | 'debug-lab' | 'self-test';

export function resolveAppMode(search: string): AppMode {
  const mode = new URLSearchParams(search).get('mode');
  return mode === 'debug-lab' || mode === 'self-test' ? mode : 'play';
}
