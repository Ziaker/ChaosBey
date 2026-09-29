// ============================================================
// APP ENTRYPOINT
// Boots the renderer and routes to one app mode. Keep this file a thin
// wiring layer — real logic belongs in the owning component module, not
// here (GDD section 1.4: no giant GameManager).
//
// Modes (URL query `mode`):
// - default: Main Menu;
// - `character-select`: M10 rotating 3D Bey selection;
// - `pregame`: M10 simulator setup shell (filled by lane B onward);
// - `play`: Player-vs-AI match;
// - `debug-lab`: Debug Lab;
// - `self-test`: browser Self Test.
// ============================================================

import { WebGl2UnavailableError, showWebGl2UnavailableScreen } from './app/bootstrap/bootFailureScreen';
import { createRenderer } from './app/bootstrap/createRenderer';
import { startCharacterSelectMode } from './app/menu/CharacterSelect';
import { startMainMenu } from './app/menu/MainMenu';
import { startPregameShell } from './app/menu/PregameShell';
import { startPlayMode } from './app/modes/playMode';
import { resolveAppMode } from './app/modes/appMode';
import { startDebugLabMode } from './debug/lab/DebugLabMode';
import { startSelfTestMode } from './debug/self-test-ui/SelfTestMode';

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#app-canvas');
  const debugOverlayRoot = document.querySelector<HTMLElement>('#debug-overlay-root');
  const attackSettingsRoot = document.querySelector<HTMLElement>('#attack-settings-root');
  if (!canvas || !debugOverlayRoot || !attackSettingsRoot) {
    throw new Error('bootstrap: required DOM mount points are missing from index.html.');
  }

  const mode = resolveAppMode(window.location.search);
  if (mode === 'menu') {
    canvas.style.display = 'none';
    startMainMenu(debugOverlayRoot);
    return;
  }
  if (mode === 'pregame') {
    canvas.style.display = 'none';
    startPregameShell(debugOverlayRoot);
    return;
  }
  if (mode === 'self-test') {
    canvas.style.display = 'none';
    await startSelfTestMode(debugOverlayRoot);
    return;
  }

  const appRenderer = createRenderer(canvas);
  if (mode === 'character-select') {
    startCharacterSelectMode(appRenderer, debugOverlayRoot);
  } else if (mode === 'debug-lab') {
    await startDebugLabMode(appRenderer, debugOverlayRoot);
  } else {
    await startPlayMode(appRenderer, { debugOverlayRoot, attackSettingsRoot });
  }
}

bootstrap().catch((error: unknown) => {
  console.error('ChaosBey failed to boot:', error);
  if (error instanceof WebGl2UnavailableError) showWebGl2UnavailableScreen();
});
