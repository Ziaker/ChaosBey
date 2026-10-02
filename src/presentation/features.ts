// ============================================================
// PRESENTATION FEATURE FLAGS
// Switches for the approved presentation packages
// (docs/planning/PROTOTYPE_INTEGRATION_MAP.md). Flags gate presentation only
// (what is drawn); none of them reaches the simulation, the replay or the
// state hash.
//
// Three sets, three meanings:
// - PRESENTATION_FEATURES_DEFAULT: the normal game. The five approved
//   packages are on (4-piece Bey models, condition visuals, Hybrid VFX +
//   Cel Cyclone, Clash Overdrive, arena art); `newHud` stays off.
// - PRESENTATION_FEATURES_OFF: the explicit all-off baseline (the game as it
//   was before these packages), for tests, comparisons and debugging.
// - `?pfx=` in the URL: an explicit allowlist for isolating packages. It
//   starts from all-off and turns on only what it names (`?pfx=hybridVfx`,
//   `?pfx=hybridVfx,arenaVisuals`, `?pfx=all`); `?pfx=` with nothing after it
//   is all-off. Without `pfx` the page gets the normal defaults.
//
// This is not a settings screen and not a mod system.
// ============================================================

export const PRESENTATION_FEATURE_IDS = ['newBeyVisuals', 'conditionVisuals', 'hybridVfx', 'clashPresentation', 'newHud', 'arenaVisuals'] as const;

export type PresentationFeatureId = (typeof PRESENTATION_FEATURE_IDS)[number];

export type PresentationFeatures = Readonly<Record<PresentationFeatureId, boolean>>;

/** Every presentation feature off: the baseline before the approved packages (tests, comparison, debugging). */
export const PRESENTATION_FEATURES_OFF: PresentationFeatures = Object.freeze({
  newBeyVisuals: false,
  conditionVisuals: false,
  hybridVfx: false,
  clashPresentation: false,
  newHud: false,
  arenaVisuals: false,
});

/** The normal game: the five approved presentation packages on, `newHud` off. Used when the page URL has no `pfx`. */
export const PRESENTATION_FEATURES_DEFAULT: PresentationFeatures = Object.freeze({
  newBeyVisuals: true,
  conditionVisuals: true,
  hybridVfx: true,
  clashPresentation: true,
  newHud: false,
  arenaVisuals: true,
});

/** URL query parameter for an explicit allowlist (debug isolation): `?pfx=hybridVfx,arenaVisuals`, `?pfx=all`, or `?pfx=` for all-off. */
export const PRESENTATION_FEATURES_PARAM = 'pfx';

export interface ParsedPresentationFeatures {
  readonly features: PresentationFeatures;
  /** Names in the parameter that are not a feature (ignored, reported so a typo is visible). */
  readonly unknown: readonly string[];
}

/**
 * Reads the `pfx` parameter from a query string (with or without the leading `?`).
 * Absent: the normal defaults. Present: an allowlist starting from all-off (empty value: all-off).
 */
export function parsePresentationFeatures(search: string): ParsedPresentationFeatures {
  const params = new URLSearchParams(search);
  if (!params.has(PRESENTATION_FEATURES_PARAM)) return { features: PRESENTATION_FEATURES_DEFAULT, unknown: [] };
  const raw = params.get(PRESENTATION_FEATURES_PARAM) ?? '';
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const enabled: Partial<Record<PresentationFeatureId, boolean>> = {};
  const unknown: string[] = [];
  for (const name of names) {
    if (name === 'all') {
      for (const id of PRESENTATION_FEATURE_IDS) enabled[id] = true;
    } else if ((PRESENTATION_FEATURE_IDS as readonly string[]).includes(name)) {
      enabled[name as PresentationFeatureId] = true;
    } else {
      unknown.push(name);
    }
  }
  return { features: resolvePresentationFeatures(enabled), unknown };
}

/** All flags off except the ones given. */
export function resolvePresentationFeatures(overrides: Partial<Record<PresentationFeatureId, boolean>> = {}): PresentationFeatures {
  return Object.freeze({ ...PRESENTATION_FEATURES_OFF, ...overrides });
}

export function isAnyPresentationFeatureOn(features: PresentationFeatures): boolean {
  return PRESENTATION_FEATURE_IDS.some((id) => features[id]);
}

/**
 * The flags a browser session starts with: the page URL's `pfx` allowlist, or
 * the normal defaults when the URL has none. Without a page at all (Node
 * tests, headless runs) everything is off, so headless code stays on the
 * baseline unless it passes flags explicitly. Read once when a session is
 * created; a session given explicit flags never looks.
 */
export function presentationFeaturesFromLocation(): PresentationFeatures {
  const location = (globalThis as { location?: { search?: string } }).location;
  if (!location) return PRESENTATION_FEATURES_OFF;
  return parsePresentationFeatures(location.search ?? '').features;
}
