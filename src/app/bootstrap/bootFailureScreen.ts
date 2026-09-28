// ============================================================
// BOOT FAILURE SCREEN
// GDD section 117: a release build may fail gracefully, but the error must
// stay diagnosable. When the browser/device can't create the WebGL2
// context the renderer needs, the page would otherwise stay blank with the
// reason only in the console. This shows a minimal, plain message instead;
// the full error is still logged to the console by main.ts. No WebGL1
// fallback and no retry: the message only says what happened and what the
// player can do (owner decision, PR #27 review, 2026-09-27).
// ============================================================

/** Thrown by createRenderer() when three.js can't create its WebGL2 context. */
export class WebGl2UnavailableError extends Error {
  constructor(cause: unknown) {
    super(`WebGL2 context could not be created: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'WebGl2UnavailableError';
  }
}

export const BOOT_FAILURE_SCREEN_ID = 'boot-failure';

/** Player-facing text, in the game's UI language (index.html is lang="en"). */
export const WEBGL2_UNAVAILABLE_LINES = {
  title: "ChaosBey couldn't start",
  reason: "Your browser or device couldn't create a WebGL2 context.",
  advice: 'Update your browser and graphics drivers, or try another browser or device.',
  details: 'Technical details are in the browser console.',
} as const;

/** Replaces the (empty) page with the WebGL2-unavailable message. Idempotent. */
export function showWebGl2UnavailableScreen(doc: Document = document): void {
  if (doc.getElementById(BOOT_FAILURE_SCREEN_ID)) return;

  const screen = doc.createElement('div');
  screen.id = BOOT_FAILURE_SCREEN_ID;
  screen.setAttribute('role', 'alert');
  Object.assign(screen.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2000',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    padding: '2rem',
    boxSizing: 'border-box',
    background: '#000',
    color: '#eee',
    font: '16px/1.5 system-ui, sans-serif',
    textAlign: 'center',
  });

  const title = doc.createElement('h1');
  title.textContent = WEBGL2_UNAVAILABLE_LINES.title;
  title.style.margin = '0 0 0.5rem';
  title.style.fontSize = '1.5rem';
  screen.appendChild(title);

  for (const text of [WEBGL2_UNAVAILABLE_LINES.reason, WEBGL2_UNAVAILABLE_LINES.advice, WEBGL2_UNAVAILABLE_LINES.details]) {
    const line = doc.createElement('p');
    line.textContent = text;
    line.style.margin = '0';
    screen.appendChild(line);
  }

  doc.body.appendChild(screen);
}
