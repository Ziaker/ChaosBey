// ============================================================
// APP ENTRYPOINT
// Boots the renderer and routes to one app mode. Keep this file a thin
// wiring layer — real logic belongs in the owning component module, not
// here (GDD section 1.4: no giant GameManager).
//
// Modes (URL query `mode`):
// - default (no `mode`): the Main Menu (app/menu/MainMenu.ts), whose
//   entries load the URLs below;
// - `play`: the player flow — Character Select, the Player-vs-AI match,
//   Results (app/modes/playMode.ts); `play&quick` starts the match directly;
// - `settings`: the Settings screen (app/modes/settingsMode.ts);
// - `debug-lab`: the Debug Lab developer tool (debug/lab/DebugLabMode.ts);
// - `combat-hud-lab`: three HUD directions over the real MatchSession;
// - `self-test`: the browser Self Test (debug/self-test-ui/SelfTestMode.ts).
// ============================================================

import { WebGl2UnavailableError, showWebGl2UnavailableScreen } from './app/bootstrap/bootFailureScreen';
import { createRenderer } from './app/bootstrap/createRenderer';
import { showVersionBadge } from './app/bootstrap/versionBadge';
import { startMainMenu } from './app/menu/MainMenu';
import { GamepadMenuKeys } from './input/devices/GamepadMenuKeys';
import { startPlayMode } from './app/modes/playMode';
import { startSettingsMode } from './app/modes/settingsMode';
import { isQuickPlay, resolveAppMode } from './app/modes/appMode';
import { startDebugLabMode } from './debug/lab/DebugLabMode';
import { startCombatHudLabMode } from './debug/combat-hud-lab/CombatHudLabMode';
import { startSelfTestMode } from './debug/self-test-ui/SelfTestMode';

async function bootstrap(): Promise<void> {
  showVersionBadge();
  const canvas = document.querySelector<HTMLCanvasElement>('#app-canvas');
  const debugOverlayRoot = document.querySelector<HTMLElement>('#debug-overlay-root');
  const attackSettingsRoot = document.querySelector<HTMLElement>('#attack-settings-root');
  const screenRoot = document.querySelector<HTMLElement>('#screen-root');
  if (!canvas || !debugOverlayRoot || !attackSettingsRoot || !screenRoot) {
    throw new Error('bootstrap: required DOM mount points are missing from index.html.');
  }

  const mode = resolveAppMode(window.location.search);
  if (mode === 'menu') {
    // A plain DOM menu: no renderer or physics world is created for it.
    canvas.style.display = 'none';
    startMainMenu(debugOverlayRoot);
    new GamepadMenuKeys().start();
    return;
  }
  if (mode === 'settings') {
    canvas.style.display = 'none';
    startSettingsMode(screenRoot);
    return;
  }
  if (mode === 'self-test') {
    // Headless core + 2D minimap: the 3D renderer is not created at all.
    canvas.style.display = 'none';
    await startSelfTestMode(debugOverlayRoot);
    return;
  }
  const appRenderer = createRenderer(canvas);
  if (mode === 'debug-lab') {
    await startDebugLabMode(appRenderer, debugOverlayRoot);
  } else if (mode === 'combat-hud-lab') {
    await startCombatHudLabMode(appRenderer, debugOverlayRoot);
  } else {
    await startPlayMode(appRenderer, { debugOverlayRoot, attackSettingsRoot, screenRoot }, { quick: isQuickPlay(window.location.search) });
  }
}

bootstrap().catch((error: unknown) => {
  // Errors must never be swallowed silently (GDD section 117).
  console.error('ChaosBey failed to boot:', error);
  if (error instanceof WebGl2UnavailableError) showWebGl2UnavailableScreen();
});
