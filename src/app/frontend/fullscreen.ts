// ============================================================
// FULLSCREEN (M10, GDD 55)
// Thin, failure-tolerant wrapper over the Fullscreen API: a browser that
// refuses (no user gesture, iframe without permission, unsupported) just
// stays windowed, and says so instead of throwing.
// ============================================================

export function isFullscreenSupported(): boolean {
  return typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenElement !== null && document.fullscreenElement !== undefined;
}

/** Enters or leaves fullscreen. Resolves to whether the page is fullscreen afterwards. */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (isFullscreen()) await document.exitFullscreen();
    else if (isFullscreenSupported()) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (error) {
    console.warn('ChaosBey: fullscreen request refused:', error);
  }
  return isFullscreen();
}
