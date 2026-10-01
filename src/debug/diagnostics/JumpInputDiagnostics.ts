// ============================================================
// TEMPORARY DIAGNOSTIC INSTRUMENTATION — added 2026-10-01 to investigate
// the owner's real-world report ("the normal jump only does a short hop").
// Purely observational: nothing here is ever read back into a gameplay
// decision, and every call is a no-op unless explicitly enabled (default
// off, so normal play/tests/the web build are completely unaffected).
// Safe to delete once the root cause is found and fixed — not meant to be
// permanent.
//
// Enable with ?jumpDiag=1 on the page URL. Every event is pushed to an
// in-memory ring buffer (window.__chaosBeyJumpDiag) and printed to the
// console tagged `[JUMP-DIAG]`, so it's readable even if DevTools wasn't
// open in time to catch earlier lines — open DevTools (Ctrl+Shift+I in the
// Electron build), filter the console for "JUMP-DIAG", and copy the lines
// out, or call `window.__chaosBeyJumpDiag.dump()` for a plain-text block.
// ============================================================

export interface JumpDiagEvent {
  t: number;
  type: string;
  [key: string]: unknown;
}

let enabled = false;
const events: JumpDiagEvent[] = [];
const MAX_EVENTS = 2000;

export function isJumpDiagEnabled(): boolean {
  return enabled;
}

export function logJumpDiag(type: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return;
  const event: JumpDiagEvent = { t: Math.round(performance.now()), type, ...data };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  // eslint-disable-next-line no-console
  console.log('[JUMP-DIAG]', JSON.stringify(event));
}

/** Reads `?jumpDiag=1` from the page URL and, if present, turns this on and installs the window/document-level listeners (keydown/keyup for X, blur/focus, visibilitychange). Call once at app bootstrap. */
export function installJumpInputDiagnosticsFromUrl(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('jumpDiag') !== '1') return;
  enabled = true;
  logJumpDiag('diagnostics-enabled');

  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyX') return;
    logJumpDiag(e.type === 'keydown' ? 'dom-keydown' : 'dom-keyup', { repeat: e.repeat, hasFocus: document.hasFocus() });
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', () => logJumpDiag('window-blur', { hasFocus: document.hasFocus() }));
  window.addEventListener('focus', () => logJumpDiag('window-focus', { hasFocus: document.hasFocus() }));
  document.addEventListener('visibilitychange', () => logJumpDiag('visibilitychange', { visibilityState: document.visibilityState, hasFocus: document.hasFocus() }));

  (window as unknown as { __chaosBeyJumpDiag: Record<string, unknown> }).__chaosBeyJumpDiag = {
    events: () => events.slice(),
    dump: () => events.map((e) => JSON.stringify(e)).join('\n'),
    clear: () => {
      events.length = 0;
    },
  };

  installApexTracker();
}

/**
 * A self-contained apex/grounded tracker, independent of DriftController
 * (doesn't touch its body contract — this polls the same session handle
 * the Debug Lab/Play-flow smoke tests already use). Finds whichever of
 * `window.__chaosBeyPlay`/`window.__chaosBeyDebugLab` has a live session,
 * and logs a 'landedApex' event with the peak height reached since the Bey
 * last left the ground, every time it lands again.
 */
function installApexTracker(): void {
  let baseYm: number | null = null;
  let peakM = 0;
  let wasGrounded = true;

  const poll = (): void => {
    const w = window as unknown as {
      __chaosBeyPlay?: { getSession: () => { getBey: (s: 'first') => { body: { translation: () => { y: number } } } } | null };
      __chaosBeyDebugLab?: { getSession: () => { getBey: (s: 'first') => { body: { translation: () => { y: number } } }; getLastResult: () => { first: { grounded: boolean } } | null } | null };
    };
    const session = w.__chaosBeyPlay?.getSession() ?? w.__chaosBeyDebugLab?.getSession() ?? null;
    if (session) {
      const body = session.getBey('first').body;
      const y = body.translation().y;
      const lastResult = (session as { getLastResult?: () => { first: { grounded: boolean } } | null }).getLastResult?.();
      const grounded = lastResult ? lastResult.first.grounded : null;
      if (baseYm === null) baseYm = y;
      if (grounded === false) {
        if (wasGrounded) baseYm = y;
        peakM = Math.max(peakM, y - (baseYm ?? y));
        wasGrounded = false;
      } else if (grounded === true && !wasGrounded) {
        logJumpDiag('landedApex', { apexM: Math.round(peakM * 1000) / 1000 });
        peakM = 0;
        baseYm = y;
        wasGrounded = true;
      }
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}
