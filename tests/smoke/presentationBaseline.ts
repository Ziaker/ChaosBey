// ============================================================
// ALL-OFF PRESENTATION BASELINE FOR GAMEPLAY / FLOW / TIMING SMOKES
// Since 0.16.0 the normal game turns on the five approved presentation
// packages (src/presentation/features.ts). Chromium's software WebGL renders
// them at ~2 fps (measured: ~515 ms a frame vs ~47 ms all-off), which starves
// tests whose subject is gameplay, input, the Debug Lab, rounds, focus,
// timing or flow (clicks waiting for a stable element, overlays read per
// frame, wall-clock asserts). Those specs open the game with the explicit
// all-off allowlist (`pfx=` with nothing after it); the menu keeps it across
// screens. The normal game itself (packages on) stays covered by
// normalGame.spec.ts, presentationFlags.spec.ts and boot.spec.ts.
// Not a global setting on purpose: the Playwright config does not add it.
// ============================================================

/** The URL with the all-off presentation baseline (`pfx=`) added. */
export function baselineUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}pfx=`;
}

/** The menu URL once the baseline is on (the menu keeps `pfx=` and drops `mode`). */
export const BASELINE_MENU_URL = /\/ChaosBey\/\?pfx=$/;
