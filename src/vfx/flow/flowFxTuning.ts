// ============================================================
// FLOW FX — THE VALUES (Settings sliders)
// The effects of the "Fluxo do Bey" lab (prototypes/bey-flow-fx-concepts) as
// they live in the game: spin blur, lean in the curve, a small blob shadow,
// anime dust in real volume, torn wind streaks, the shock rings / crowns / star
// of a Dash release and of a hit, and the comic HIT / COUNTER! words.
//
// Every number is a Settings slider (Settings → Visual effects). The defaults
// are the owner's own numbers from the lab's tuning panel (2026-10-08), and
// the ranges are the lab's. PRESENTATION ONLY: none of it reads or changes
// what a fixed tick computes, the replay or the state hash (GDD 89).
//
// The dust composition is a choice (wave / crown / cloud) because the owner has
// not picked one yet (docs/design-decisions/flow-fx-effects.md); the lab's Q
// ("onda com cauda") is the default as the one the owner called acceptable.
// ============================================================

export type FlowFxGroup = 'blur' | 'lean' | 'shadow' | 'dust' | 'wind' | 'impact' | 'words';

export interface FlowFxValues {
  // --- Spin blur (× the approved condition blur) ---
  blurStrength: number;
  // --- Lean into the curve ---
  leanMaxDeg: number;
  leanAccelRefMps2: number;
  leanSmooth: number;
  // --- Blob shadow ---
  shadowOpacity: number;
  shadowScale: number;
  // --- Anime dust ---
  dustOpacity: number;
  dustFade: number;
  dustShrink: number;
  dustRate: number;
  dustSizeM: number;
  dustLifeS: number;
  dustDashBoost: number;
  // --- Wind streaks ---
  windRate: number;
  windLengthM: number;
  windWidthM: number;
  windLifeS: number;
  // --- Rings, crowns and star (Dash release and hit) ---
  crownCount: number;
  crownSizeM: number;
  burstSizeM: number;
  // --- Comic words ---
  calloutScale: number;
  calloutLifeS: number;
  // --- Global ---
  intensity: number;
}

export type DustStyle = 'wave' | 'crown' | 'cloud';
export const DUST_STYLE_IDS: readonly DustStyle[] = ['wave', 'crown', 'cloud'];

export interface FlowFxSettings {
  /** Which dust composition: Q wave with tail, W splash crown, E blast cloud. */
  readonly dustStyle: DustStyle;
  /** The comic "HIT" / "COUNTER!" words (style A, "Quadrinho"). */
  readonly comicWords: boolean;
  readonly values: Readonly<FlowFxValues>;
}

export interface FlowFxSpec {
  readonly key: keyof FlowFxValues;
  readonly group: FlowFxGroup;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** How the value reads next to the slider. */
  readonly unit: '' | 'x' | 'm' | 's' | '°' | '/s' | 'm/s²' | '1/s';
}

export const FLOW_FX_GROUP_TITLES: Readonly<Record<FlowFxGroup, string>> = {
  blur: 'Spin blur',
  lean: 'Lean in the curve',
  shadow: 'Shadow under the Bey',
  dust: 'Anime dust',
  wind: 'Wind streaks',
  impact: 'Rings, crowns and impact star',
  words: 'Comic words (HIT / COUNTER!)',
};

/** The owner's numbers from the lab's tuning panel (2026-10-08). */
export const FLOW_FX_DEFAULT_VALUES: Readonly<FlowFxValues> = Object.freeze({
  intensity: 1,
  blurStrength: 1.35,
  leanMaxDeg: 26,
  leanAccelRefMps2: 13,
  leanSmooth: 9,
  shadowOpacity: 0.5,
  shadowScale: 0.9,
  dustOpacity: 1,
  dustFade: 0.95,
  dustShrink: 0.5,
  dustRate: 4,
  dustSizeM: 0.4,
  dustLifeS: 0.3,
  dustDashBoost: 2.5,
  windRate: 30,
  windLengthM: 1.1,
  windWidthM: 0.25,
  windLifeS: 0.25,
  crownCount: 2,
  crownSizeM: 6.1,
  burstSizeM: 1.4,
  calloutScale: 0.55,
  calloutLifeS: 0.55,
});

export const DEFAULT_FLOW_FX_SETTINGS: FlowFxSettings = Object.freeze({
  dustStyle: 'wave',
  comicWords: true,
  values: FLOW_FX_DEFAULT_VALUES,
});

export const FLOW_FX_SPEC: readonly FlowFxSpec[] = [
  { key: 'intensity', group: 'impact', label: 'Overall effects intensity', min: 0, max: 2, step: 0.05, unit: 'x' },

  { key: 'blurStrength', group: 'blur', label: 'Blur strength (0 = off)', min: 0, max: 1.5, step: 0.05, unit: 'x' },

  { key: 'leanMaxDeg', group: 'lean', label: 'Maximum lean (0 = off)', min: 0, max: 40, step: 1, unit: '°' },
  { key: 'leanAccelRefMps2', group: 'lean', label: 'Sideways acceleration for the maximum', min: 4, max: 40, step: 1, unit: 'm/s²' },
  { key: 'leanSmooth', group: 'lean', label: 'Lean smoothing', min: 2, max: 30, step: 1, unit: '1/s' },

  { key: 'shadowOpacity', group: 'shadow', label: 'Shadow opacity (0 = off)', min: 0, max: 1, step: 0.05, unit: '' },
  { key: 'shadowScale', group: 'shadow', label: 'Shadow size (× the Bey)', min: 0.5, max: 2, step: 0.05, unit: 'x' },

  { key: 'dustOpacity', group: 'dust', label: 'Cloud opacity', min: 0.1, max: 1, step: 0.05, unit: '' },
  { key: 'dustFade', group: 'dust', label: 'Opacity over its life: how early a cloud starts to fade (0 = only at the very end, 1 = from the start)', min: 0, max: 1, step: 0.05, unit: '' },
  { key: 'dustShrink', group: 'dust', label: 'How much the lumps shrink by the end', min: 0, max: 1, step: 0.05, unit: '' },
  { key: 'dustRate', group: 'dust', label: 'Dust emissions per second (0 = off)', min: 0, max: 40, step: 1, unit: '/s' },
  { key: 'dustSizeM', group: 'dust', label: 'Base cloud size', min: 0.2, max: 4, step: 0.05, unit: 'm' },
  { key: 'dustLifeS', group: 'dust', label: 'Cloud life', min: 0.2, max: 2.5, step: 0.05, unit: 's' },
  { key: 'dustDashBoost', group: 'dust', label: 'Extra dust while dashing', min: 0, max: 4, step: 0.1, unit: 'x' },

  { key: 'windRate', group: 'wind', label: 'Streaks per second (0 = off)', min: 0, max: 40, step: 1, unit: '/s' },
  { key: 'windLengthM', group: 'wind', label: 'Streak length', min: 0.8, max: 6, step: 0.1, unit: 'm' },
  { key: 'windWidthM', group: 'wind', label: 'Streak width', min: 0.2, max: 2, step: 0.05, unit: 'm' },
  { key: 'windLifeS', group: 'wind', label: 'Streak life', min: 0.2, max: 1.5, step: 0.05, unit: 's' },

  { key: 'crownCount', group: 'impact', label: 'Shock rings per Dash and hit (0 = off)', min: 0, max: 5, step: 1, unit: '' },
  { key: 'crownSizeM', group: 'impact', label: 'Ring and crown size', min: 1, max: 9, step: 0.1, unit: 'm' },
  { key: 'burstSizeM', group: 'impact', label: 'Dust burst and star size', min: 1, max: 7, step: 0.1, unit: 'm' },

  { key: 'calloutScale', group: 'words', label: 'Word size', min: 0.5, max: 2, step: 0.05, unit: 'x' },
  { key: 'calloutLifeS', group: 'words', label: 'Word duration', min: 0.4, max: 2, step: 0.05, unit: 's' },
];

export const FLOW_FX_GROUP_ORDER: readonly FlowFxGroup[] = ['blur', 'lean', 'shadow', 'dust', 'wind', 'impact', 'words'];

export const DUST_STYLE_LABELS: Readonly<Record<DustStyle, string>> = {
  wave: 'Wave with a tail',
  crown: 'Splash crown',
  cloud: 'Blast cloud',
};

/** Field-by-field validation: a missing, non-numeric or out-of-range value falls back to / clamps to the slider's range. */
export function sanitizeFlowFxSettings(value: unknown): FlowFxSettings {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawValues = input.values && typeof input.values === 'object' ? (input.values as Record<string, unknown>) : {};
  const values: FlowFxValues = { ...FLOW_FX_DEFAULT_VALUES };
  for (const spec of FLOW_FX_SPEC) {
    const v = rawValues[spec.key];
    if (typeof v === 'number' && Number.isFinite(v)) values[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
  }
  const dustStyle = DUST_STYLE_IDS.find((id) => id === input.dustStyle) ?? DEFAULT_FLOW_FX_SETTINGS.dustStyle;
  const comicWords = typeof input.comicWords === 'boolean' ? input.comicWords : DEFAULT_FLOW_FX_SETTINGS.comicWords;
  return { dustStyle, comicWords, values };
}

/** A copy of the settings with one slider changed (clamped to its range). */
export function withFlowFxValue(settings: FlowFxSettings, key: keyof FlowFxValues, value: number): FlowFxSettings {
  const spec = FLOW_FX_SPEC.find((s) => s.key === key)!;
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  return { ...settings, values: { ...settings.values, [key]: clamped } };
}
