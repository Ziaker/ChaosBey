// ============================================================
// APP ENTRYPOINT
// Boots the renderer and routes to one app mode. Keep this file a thin
// wiring layer — real logic belongs in the owning component module, not
// here (GDD section 1.4: no giant GameManager).
//
// Modes (URL query `mode`):
// - default: the Player-vs-AI match (app/modes/playMode.ts);
// - `debug-lab`: the Debug Lab developer tool (debug/lab/DebugLabMode.ts).
// ============================================================

import { WebGl2UnavailableError, showWebGl2UnavailableScreen } from './app/bootstrap/bootFailureScreen';
import { createRenderer } from './app/bootstrap/createRenderer';
import { startPlayMode } from './app/modes/playMode';
import { resolveAppMode } from './app/modes/appMode';
import { startDebugLabMode } from './debug/lab/DebugLabMode';

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#app-canvas');
  const debugOverlayRoot = document.querySelector<HTMLElement>('#debug-overlay-root');
  const attackSettingsRoot = document.querySelector<HTMLElement>('#attack-settings-root');
  if (!canvas || !debugOverlayRoot || !attackSettingsRoot) {
    throw new Error('bootstrap: required DOM mount points are missing from index.html.');
  }

  const appRenderer = createRenderer(canvas);
  if (resolveAppMode(window.location.search) === 'debug-lab') {
    await startDebugLabMode(appRenderer, debugOverlayRoot);
  } else {
    await startPlayMode(appRenderer, { debugOverlayRoot, attackSettingsRoot });
  }
}

bootstrap().catch((error: unknown) => {
  // Errors must never be swallowed silently (GDD section 117).
  console.error('ChaosBey failed to boot:', error);
  if (error instanceof WebGl2UnavailableError) showWebGl2UnavailableScreen();
});
