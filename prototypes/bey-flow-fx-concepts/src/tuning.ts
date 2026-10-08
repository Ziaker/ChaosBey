// ============================================================
// BEY FLOW FX LAB — LIVE TUNING
// Every adjustable value of the continuous per-Bey effects and of the
// HIT / BLOCK / COUNTER words. The tuning panel edits TUNING live and
// everything reads it every frame.
//
// Round 2 (owner feedback, 2026-10-08): the owner kept the SPIN BLUR, the
// LEAN and a dust slot, and asked for the dust to be "anime, more epic" with
// "more wind"; the old ribbon, helix and ghost echo are gone.
// Round 3: the crescent wind blades are gone too, and the dust is redone with
// three ideas to compare (rolling wave, hand-drawn bubbles, shards in a fan;
// see fx/AnimeDust.ts), in the style of the owner's reference sheets and of
// the approved Cel Cyclone (src/vfx/hybrid/fx). The wind streaks and crowns stay.
//
// PROPOSED = Claude's starting values; for everything the owner tuned in the lab
// (blur, lean, dust, wind, crowns and the word) their own numbers are the starting point. None of
// it is approved yet: the final values go in
// docs/design-decisions/bey-flow-fx-approval.md.
//
// Units: the label names the unit; "x" values are multipliers (1 = proposal).
// ============================================================

import { FLOW_FX_DEFAULT_VALUES, type FlowFxValues } from '../../../src/vfx/flow/flowFxTuning';

export type TuningGroup = 'global' | 'blur' | 'lean' | 'shadow' | 'dust' | 'wind' | 'crown' | 'callout';

/** The shared Flow FX values (src/vfx/flow, the same ones the game's Settings sliders edit) plus the lab-only spin fade of its own blur shell. */
export type Tuning = FlowFxValues & {
  blurFadeSpin: number;
};

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
  blur: 'Borrão de giro',
  lean: 'Inclinação na curva',
  shadow: 'Sombra no chão',
  dust: 'Poeira anime',
  wind: 'Vento: riscos rasgados',
  crown: 'Coroas e explosão de impacto',
  callout: 'Texto HIT / BLOCK / COUNTER',
};

/** The owner's numbers from the lab's tuning panel (2026-10-08) are the starting point: the same defaults as the game's Settings. */
export const PROPOSED: Readonly<Tuning> = { ...FLOW_FX_DEFAULT_VALUES, blurFadeSpin: 0.2 };

export const TUNING_SPEC: readonly TuningSpec[] = [
  { key: 'intensity', group: 'global', label: 'Intensidade geral dos efeitos (x)', min: 0, max: 2, step: 0.05 },

  { key: 'blurStrength', group: 'blur', label: 'Força do borrão (x)', min: 0, max: 1.5, step: 0.05 },
  { key: 'blurFadeSpin', group: 'blur', label: 'Giro em que o borrão some (0–1)', min: 0.05, max: 0.9, step: 0.05 },

  { key: 'leanMaxDeg', group: 'lean', label: 'Inclinação máxima (graus)', min: 0, max: 40, step: 1 },
  { key: 'leanAccelRefMps2', group: 'lean', label: 'Aceleração lateral para o máximo (m/s²)', min: 4, max: 40, step: 1 },
  { key: 'leanSmooth', group: 'lean', label: 'Suavização (1/s)', min: 2, max: 30, step: 1 },

  { key: 'shadowOpacity', group: 'shadow', label: 'Opacidade da sombra (0–1)', min: 0, max: 1, step: 0.05 },
  { key: 'shadowScale', group: 'shadow', label: 'Tamanho da sombra (x o diâmetro do Bey)', min: 0.5, max: 2, step: 0.05 },

  { key: 'dustOpacity', group: 'dust', label: 'Opacidade da nuvem (0–1)', min: 0.1, max: 1, step: 0.05 },
  { key: 'dustFade', group: 'dust', label: 'Opacidade ao longo da vida: quão cedo a nuvem começa a sumir (0 = só no fim, 1 = desde o início)', min: 0, max: 1, step: 0.05 },
  { key: 'dustShrink', group: 'dust', label: 'Quanto os blocos encolhem até o fim (0–1)', min: 0, max: 1, step: 0.05 },
  { key: 'dustRate', group: 'dust', label: 'Emissões por segundo', min: 0, max: 40, step: 1 },
  { key: 'dustSizeM', group: 'dust', label: 'Tamanho base (m)', min: 0.4, max: 4, step: 0.1 },
  { key: 'dustLifeS', group: 'dust', label: 'Vida (s)', min: 0.3, max: 2.5, step: 0.05 },
  { key: 'dustDashBoost', group: 'dust', label: 'Reforço no Dash (x a mais)', min: 0, max: 4, step: 0.1 },

  { key: 'windRate', group: 'wind', label: 'Riscos por segundo', min: 0, max: 40, step: 1 },
  { key: 'windLengthM', group: 'wind', label: 'Comprimento (m)', min: 0.8, max: 6, step: 0.1 },
  { key: 'windWidthM', group: 'wind', label: 'Largura (m)', min: 0.2, max: 2, step: 0.05 },
  { key: 'windLifeS', group: 'wind', label: 'Vida (s)', min: 0.2, max: 1.5, step: 0.05 },


  { key: 'crownCount', group: 'crown', label: 'Anéis serrilhados no Dash', min: 0, max: 5, step: 1 },
  { key: 'crownSizeM', group: 'crown', label: 'Tamanho do anel/coroa (m)', min: 1, max: 9, step: 0.1 },
  { key: 'burstSizeM', group: 'crown', label: 'Tamanho da explosão de poeira (m)', min: 1, max: 7, step: 0.1 },

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
