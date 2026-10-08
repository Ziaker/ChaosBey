// ============================================================
// BEY FLOW FX LAB — LIVE TUNING
// Every adjustable value of the continuous per-Bey effects (wind ribbon,
// helix swirl, spin blur, ghost echoes, tip dust, lean) and of the
// Hit / Block / Counter callouts. The tuning panel edits TUNING live and
// everything reads it every frame.
//
// PROPOSED holds Claude's starting values, taken from the owner's
// references (a light-yellow stadium with cyan wind ribbons, spin blur and
// a translucent echo). They are NOT approved: the owner tunes them here
// and the final values are recorded in
// docs/design-decisions/bey-flow-fx-approval.md.
//
// Units: the label names the unit; "x" values are multipliers (1 = proposal).
// ============================================================

export type TuningGroup = 'global' | 'ribbon' | 'helix' | 'blur' | 'ghost' | 'dust' | 'lean' | 'callout';

export interface Tuning {
  // --- Global ---
  intensity: number;
  // --- Wind ribbon (the tapered cyan/white band behind the rim) ---
  ribbonLifeS: number;
  ribbonWidthM: number;
  ribbonDashWidthM: number;
  ribbonFullSpeedMps: number;
  ribbonOpacity: number;
  ribbonCore: number;
  ribbonWaveM: number;
  ribbonWaveHz: number;
  // --- Helix swirl (thin strands spiralling around the ribbon) ---
  helixRadiusM: number;
  helixTurnsPerS: number;
  helixWidthM: number;
  helixOpacity: number;
  // --- Spin blur (smeared disc, fades as the spin dies) ---
  blurStrength: number;
  blurFadeSpin: number;
  // --- Ghost echoes (translucent copies lagging on the path) ---
  ghostCount: number;
  ghostSpacingS: number;
  ghostOpacity: number;
  // --- Tip dust (scrape particles at the contact point) ---
  dustRate: number;
  dustSizeM: number;
  dustLifeS: number;
  // --- Lean (inward tilt in a curve) ---
  leanMaxDeg: number;
  leanAccelRefMps2: number;
  leanSmooth: number;
  // --- Callouts (HIT / BLOCK / COUNTER) ---
  calloutScale: number;
  calloutLifeS: number;
}

export interface TuningSpec {
  readonly key: keyof Tuning;
  readonly group: TuningGroup;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const GROUP_TITLES: Readonly<Record<TuningGroup, string>> = {
  global: 'Geral',
  ribbon: 'Fita de vento',
  helix: 'Espiral (hélice)',
  blur: 'Borrão de giro',
  ghost: 'Eco fantasma',
  dust: 'Poeira na ponta',
  lean: 'Inclinação na curva',
  callout: 'Texto HIT / BLOCK / COUNTER',
};

export const PROPOSED: Readonly<Tuning> = {
  intensity: 1,
  ribbonLifeS: 0.5,
  ribbonWidthM: 0.75,
  ribbonDashWidthM: 1.5,
  ribbonFullSpeedMps: 11,
  ribbonOpacity: 0.95,
  ribbonCore: 0.9,
  ribbonWaveM: 0.18,
  ribbonWaveHz: 2.2,
  helixRadiusM: 0.5,
  helixTurnsPerS: 2.4,
  helixWidthM: 0.12,
  helixOpacity: 0.9,
  blurStrength: 1,
  blurFadeSpin: 0.45,
  ghostCount: 3,
  ghostSpacingS: 0.07,
  ghostOpacity: 0.22,
  dustRate: 38,
  dustSizeM: 0.32,
  dustLifeS: 0.55,
  leanMaxDeg: 22,
  leanAccelRefMps2: 16,
  leanSmooth: 9,
  calloutScale: 1,
  calloutLifeS: 0.95,
};

export const TUNING_SPEC: readonly TuningSpec[] = [
  { key: 'intensity', group: 'global', label: 'Intensidade geral dos efeitos (x)', min: 0, max: 2, step: 0.05 },

  { key: 'ribbonLifeS', group: 'ribbon', label: 'Duração do rastro (s)', min: 0.1, max: 1.2, step: 0.02 },
  { key: 'ribbonWidthM', group: 'ribbon', label: 'Largura andando (m)', min: 0.04, max: 1, step: 0.02 },
  { key: 'ribbonDashWidthM', group: 'ribbon', label: 'Largura no Dash (m)', min: 0.1, max: 2, step: 0.05 },
  { key: 'ribbonFullSpeedMps', group: 'ribbon', label: 'Velocidade para força total (m/s)', min: 4, max: 30, step: 0.5 },
  { key: 'ribbonOpacity', group: 'ribbon', label: 'Opacidade', min: 0, max: 1, step: 0.05 },
  { key: 'ribbonCore', group: 'ribbon', label: 'Brilho do núcleo branco (x)', min: 0, max: 1, step: 0.05 },
  { key: 'ribbonWaveM', group: 'ribbon', label: 'Ondulação lateral (m)', min: 0, max: 0.8, step: 0.02 },
  { key: 'ribbonWaveHz', group: 'ribbon', label: 'Frequência da ondulação (Hz)', min: 0, max: 8, step: 0.1 },

  { key: 'helixRadiusM', group: 'helix', label: 'Raio da espiral (m)', min: 0, max: 1.5, step: 0.05 },
  { key: 'helixTurnsPerS', group: 'helix', label: 'Voltas por segundo', min: 0, max: 8, step: 0.1 },
  { key: 'helixWidthM', group: 'helix', label: 'Largura dos fios (m)', min: 0.02, max: 0.4, step: 0.01 },
  { key: 'helixOpacity', group: 'helix', label: 'Opacidade', min: 0, max: 1, step: 0.05 },

  { key: 'blurStrength', group: 'blur', label: 'Força do borrão (x)', min: 0, max: 1.5, step: 0.05 },
  { key: 'blurFadeSpin', group: 'blur', label: 'Giro em que o borrão some (0–1)', min: 0.05, max: 0.9, step: 0.05 },

  { key: 'ghostCount', group: 'ghost', label: 'Quantidade de ecos', min: 0, max: 6, step: 1 },
  { key: 'ghostSpacingS', group: 'ghost', label: 'Intervalo entre ecos (s)', min: 0.02, max: 0.25, step: 0.01 },
  { key: 'ghostOpacity', group: 'ghost', label: 'Opacidade do primeiro eco', min: 0, max: 0.8, step: 0.02 },

  { key: 'dustRate', group: 'dust', label: 'Partículas por segundo', min: 0, max: 120, step: 2 },
  { key: 'dustSizeM', group: 'dust', label: 'Tamanho (m)', min: 0.05, max: 0.6, step: 0.01 },
  { key: 'dustLifeS', group: 'dust', label: 'Vida (s)', min: 0.15, max: 1.5, step: 0.05 },

  { key: 'leanMaxDeg', group: 'lean', label: 'Inclinação máxima (graus)', min: 0, max: 40, step: 1 },
  { key: 'leanAccelRefMps2', group: 'lean', label: 'Aceleração lateral para o máximo (m/s²)', min: 4, max: 40, step: 1 },
  { key: 'leanSmooth', group: 'lean', label: 'Suavização (1/s)', min: 2, max: 30, step: 1 },

  { key: 'calloutScale', group: 'callout', label: 'Tamanho do texto (x)', min: 0.5, max: 2, step: 0.05 },
  { key: 'calloutLifeS', group: 'callout', label: 'Duração do texto (s)', min: 0.4, max: 2, step: 0.05 },
];

/** The live values every effect reads each frame. */
export const TUNING: Tuning = { ...PROPOSED };

export function applyTuning(values: Partial<Tuning>): void {
  for (const spec of TUNING_SPEC) {
    const v = values[spec.key];
    if (typeof v === 'number' && Number.isFinite(v)) TUNING[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
  }
}

export function resetTuning(): void {
  Object.assign(TUNING, PROPOSED);
}
