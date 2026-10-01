// ============================================================
// PRESENTATION FEATURE FLAGS
// Switches for presentation systems that are integrated one at a time
// (docs/planning/PROTOTYPE_INTEGRATION_MAP.md). Every flag is OFF by default:
// with all of them off the game behaves exactly as before this module
// existed. Flags gate presentation only (what is drawn); none of them reaches
// the simulation, the replay or the state hash.
//
// This is a development switch for comparing old and new and for fast
// rollback, not a settings screen and not a mod system. A flag only means
// something once a system that reads it exists; today nothing is registered
// behind any of them, so turning one on changes nothing.
// ============================================================

export const PRESENTATION_FEATURE_IDS = ['newBeyVisuals', 'conditionVisuals', 'hybridVfx', 'clashPresentation', 'newHud', 'arenaVisuals'] as const;

export type PresentationFeatureId = (typeof PRESENTATION_FEATURE_IDS)[number];

export type PresentationFeatures = Readonly<Record<PresentationFeatureId, boolean>>;

/** Every presentation feature off: the game as it was. */
export const PRESENTATION_FEATURES_OFF: PresentationFeatures = Object.freeze({
  newBeyVisuals: false,
  conditionVisuals: false,
  hybridVfx: false,
  clashPresentation: false,
  newHud: false,
  arenaVisuals: false,
});

/** URL query parameter that turns features on for a development session: `?pfx=hybridVfx,newHud` or `?pfx=all`. */
export const PRESENTATION_FEATURES_PARAM = 'pfx';

export interface ParsedPresentationFeatures {
  readonly features: PresentationFeatures;
  /** Names in the parameter that are not a feature (ignored, reported so a typo is visible). */
  readonly unknown: readonly string[];
}

/** Reads the `pfx` parameter from a query string (with or without the leading `?`). Absent or empty: everything off. */
export function parsePresentationFeatures(search: string): ParsedPresentationFeatures {
  const raw = new URLSearchParams(search).get(PRESENTATION_FEATURES_PARAM);
  if (!raw) return { features: PRESENTATION_FEATURES_OFF, unknown: [] };
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
 * The flags a browser session starts with: the `pfx` parameter of the page URL,
 * or everything off when there is no page (tests, headless runs). Read once
 * when a session is created; a session given explicit flags never looks.
 */
export function presentationFeaturesFromLocation(): PresentationFeatures {
  const search = (globalThis as { location?: { search?: string } }).location?.search;
  return search ? parsePresentationFeatures(search).features : PRESENTATION_FEATURES_OFF;
}
