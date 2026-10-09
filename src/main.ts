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
// - `self-test`: the browser Self Test (debug/self-test-ui/SelfTestMode.ts).
// ============================================================

import { WebGl2UnavailableError, showWebGl2UnavailableScreen } from './app/bootstrap/bootFailureScreen';
import { showVersionBadge } from './app/bootstrap/versionBadge';
import { startMainMenu } from './app/menu/MainMenu';
import { GamepadMenuKeys } from './input/devices/GamepadMenuKeys';
import { isQuickPlay, resolveAppMode } from './app/modes/appMode';
import { DEFAULT_PLAYER_SETTINGS, QUALITY_PROFILES, hasSavedPlayerSettings, loadPlayerSettings, savePlayerSettings } from './config/settings/PlayerSettings';
import type { QualityPreset } from './config/runtime/QualityPreset';
import { detectDefaultQuality, probeDevice } from './config/runtime/deviceCapability';

// Each mode is its own chunk (0.62.0): the Main Menu loads only the menu, not three.js, the physics engine (a 4 MB WASM carried
// as text) or the other modes. PLAY's chunks are fetched while the menu sits idle, and PLAY itself enters in place (no page reload).
const loadPlayMode = () => import('./app/modes/playMode');
const loadRenderer = () => import('./app/bootstrap/createRenderer');

/**
 * The quality preset the renderer is built for. A first launch (no saved Settings) on a clearly modest machine starts on Low and
 * remembers it (the player can change it in Settings); automated browsers keep the default so tests stay comparable.
 */
function startingQuality(): QualityPreset {
  if (!hasSavedPlayerSettings() && !navigator.webdriver) {
    const quality = detectDefaultQuality(probeDevice());
    if (quality !== DEFAULT_PLAYER_SETTINGS.quality) savePlayerSettings({ ...DEFAULT_PLAYER_SETTINGS, quality });
    return quality;
  }
  return loadPlayerSettings().quality;
}

interface Mounts {
  readonly canvas: HTMLCanvasElement;
  readonly debugOverlayRoot: HTMLElement;
  readonly attackSettingsRoot: HTMLElement;
  readonly screenRoot: HTMLElement;
}

/** The 3D modes (play, debug lab): a renderer on the canvas, then the mode. */
async function startRendered(mode: 'play' | 'debug-lab', mounts: Mounts): Promise<void> {
  const { createRenderer } = await loadRenderer();
  const appRenderer = createRenderer(mounts.canvas, { antialias: QUALITY_PROFILES[startingQuality()].antialias });
  if (mode === 'debug-lab') {
    const { startDebugLabMode } = await import('./debug/lab/DebugLabMode');
    await startDebugLabMode(appRenderer, mounts.debugOverlayRoot);
  } else {
    const { startPlayMode } = await loadPlayMode();
    await startPlayMode(appRenderer, { debugOverlayRoot: mounts.debugOverlayRoot, attackSettingsRoot: mounts.attackSettingsRoot, screenRoot: mounts.screenRoot }, { quick: isQuickPlay(window.location.search) });
  }
}

/** While the menu is up and the browser has nothing else to do, fetch what PLAY needs, so pressing it is instant. */
function prefetchPlay(): void {
  const run = (): void => {
    void loadRenderer().catch(() => undefined);
    void loadPlayMode().catch(() => undefined);
  };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(run, { timeout: 2500 });
  else setTimeout(run, 400);
}

async function bootstrap(): Promise<void> {
  showVersionBadge();
  const canvas = document.querySelector<HTMLCanvasElement>('#app-canvas');
  const debugOverlayRoot = document.querySelector<HTMLElement>('#debug-overlay-root');
  const attackSettingsRoot = document.querySelector<HTMLElement>('#attack-settings-root');
  const screenRoot = document.querySelector<HTMLElement>('#screen-root');
  if (!canvas || !debugOverlayRoot || !attackSettingsRoot || !screenRoot) {
    throw new Error('bootstrap: required DOM mount points are missing from index.html.');
  }

  const mounts: Mounts = { canvas, debugOverlayRoot, attackSettingsRoot, screenRoot };
  const mode = resolveAppMode(window.location.search);
  if (mode === 'menu') {
    // A plain DOM menu: no renderer or physics world is created for it.
    canvas.style.display = 'none';
    const gamepadKeys = new GamepadMenuKeys();
    const menu = startMainMenu(debugOverlayRoot, {
      navigate: (href) => {
        if (new URL(href, window.location.href).searchParams.get('mode') !== 'play') {
          window.location.assign(href);
          return;
        }
        // PLAY enters in place: the menu goes away, the address changes to ?mode=play, and the play chunks (already fetched while
        // the menu was idle) start — no second page load, no second parse of three.js and the physics engine.
        gamepadKeys.stop();
        menu.dispose();
        history.pushState(null, '', href);
        window.addEventListener('popstate', () => window.location.reload()); // Back returns to the menu: a plain load of it
        canvas.style.display = '';
        void startRendered('play', mounts).catch(reportBootFailure);
      },
    });
    gamepadKeys.start();
    prefetchPlay();
    return;
  }
  if (mode === 'settings') {
    canvas.style.display = 'none';
    const { startSettingsMode } = await import('./app/modes/settingsMode');
    startSettingsMode(screenRoot);
    return;
  }
  if (mode === 'self-test') {
    // Headless core + 2D minimap: the 3D renderer is not created at all.
    canvas.style.display = 'none';
    const { startSelfTestMode } = await import('./debug/self-test-ui/SelfTestMode');
    await startSelfTestMode(debugOverlayRoot);
    return;
  }
  await startRendered(mode, mounts);
}

function reportBootFailure(error: unknown): void {
  // Errors must never be swallowed silently (GDD section 117).
  console.error('ChaosBey failed to boot:', error);
  if (error instanceof WebGl2UnavailableError) showWebGl2UnavailableScreen();
}

bootstrap().catch(reportBootFailure);
