// ============================================================
// SFX LAB — THE THREE SOUND DIRECTIONS (central tuning)
// A, B and C are three COHERENT sound identities for the whole game, not
// three random sounds per event: every recipe (recipes.ts) is built from
// the same few families (impact, whoosh, sting, UI, loops) and reads its
// timbre from the palette below, so B's hit, Dash, Clash and KO all sound
// like the same game.
//
// Everything a sound designer would want to nudge lives here, at the top:
// frequencies in Hz, times in seconds, gains 0..1. Change a number, reload
// the page. None of it is approved; the owner picks per event.
// ============================================================

export type DirectionId = 'A' | 'B' | 'C';
export const DIRECTION_IDS: readonly DirectionId[] = ['A', 'B', 'C'];

/** How a direction builds its "moment" stingers (break, dodge, round end…). */
export type StingStyle = 'metal' | 'melodic' | 'dissonant';

export interface DirectionPalette {
  readonly id: DirectionId;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly color: string;
  /** Overall level trim (linear) so A, B and C compare on character, not loudness. */
  readonly level: number;
  /** 0..1 saturation/distortion on every voice (C is the gritty one). */
  readonly drive: number;
  /** 0..1 send to the short shared "arena air" slap. */
  readonly air: number;
  readonly impact: {
    readonly thumpHz: number;
    readonly thumpEndHz: number;
    readonly thumpDecayS: number;
    readonly thumpGain: number;
    /** Noise transient: filter type/center, length, level. */
    readonly snapFilter: BiquadFilterType;
    readonly snapHz: number;
    readonly snapQ: number;
    readonly snapDecayS: number;
    readonly snapGain: number;
    /** Tonal/metal ring: base pitch and partial ratios (inharmonic = metal). */
    readonly ringWave: OscillatorType;
    readonly ringHz: number;
    readonly ringRatios: readonly number[];
    readonly ringDecayS: number;
    readonly ringGain: number;
    /** Pitch bend down on the ring, in semitones (C drops hard). */
    readonly ringDropSemis: number;
  };
  readonly whoosh: {
    readonly startHz: number;
    readonly endHz: number;
    readonly q: number;
    readonly lengthS: number;
    readonly gain: number;
    /** Optional synth layer riding the sweep (B/C). */
    readonly toneWave: OscillatorType | null;
    readonly toneGain: number;
    /** Swirl modulation for the Circular Attack (Hz). */
    readonly swirlHz: number;
  };
  readonly sting: {
    readonly style: StingStyle;
    readonly wave: OscillatorType;
    readonly rootHz: number;
    /** Semitone steps for positive moments (up) and negative ones (down). */
    readonly up: readonly number[];
    readonly down: readonly number[];
    readonly noteS: number;
    readonly gain: number;
    /** 0..1 sparkle layer (B). */
    readonly shimmer: number;
  };
  readonly ui: {
    readonly wave: OscillatorType;
    readonly baseHz: number;
    readonly decayS: number;
    readonly gain: number;
    /** 0..1 noise click mixed in (A is mechanical). */
    readonly click: number;
  };
  readonly loops: {
    readonly spin: { readonly wave: OscillatorType; readonly baseHz: number; readonly rangeHz: number; readonly noise: number; readonly tremolo: number; readonly gain: number };
    readonly scrape: { readonly centerHz: number; readonly q: number; readonly gain: number; readonly grit: number };
    readonly grind: { readonly centerHz: number; readonly q: number; readonly ringHz: number; readonly gain: number };
    readonly charge: { readonly wave: OscillatorType; readonly startHz: number; readonly endHz: number; readonly gain: number; readonly ratchetHz: number };
    readonly tension: { readonly wave: OscillatorType; readonly baseHz: number; readonly beatHz: number; readonly gain: number; readonly noise: number };
  };
}

// ---------------------------------------------------------------- A ----
export const DIRECTION_A: DirectionPalette = {
  id: 'A',
  name: 'Mecânico',
  tagline: 'Metal, plástico, atrito e peso físico',
  description: 'Soa como um brinquedo de metal e plástico de verdade: clanks inarmônicos, raspadas secas, pancadas com corpo. Quase sem notas musicais; os momentos grandes são metal ressoando.',
  color: '#6fd3ff',
  level: 1,
  drive: 0.08,
  air: 0.14,
  impact: {
    thumpHz: 120, thumpEndHz: 52, thumpDecayS: 0.11, thumpGain: 0.75,
    snapFilter: 'bandpass', snapHz: 3200, snapQ: 0.9, snapDecayS: 0.045, snapGain: 0.85,
    ringWave: 'sine', ringHz: 540, ringRatios: [1, 2.41, 3.87, 5.31, 7.12], ringDecayS: 0.24, ringGain: 0.34, ringDropSemis: 0,
  },
  whoosh: { startHz: 450, endHz: 1900, q: 1.1, lengthS: 0.24, gain: 0.75, toneWave: null, toneGain: 0, swirlHz: 16 },
  sting: { style: 'metal', wave: 'sine', rootHz: 392, up: [0, 5, 12], down: [0, -5, -12], noteS: 0.09, gain: 0.5, shimmer: 0 },
  ui: { wave: 'triangle', baseHz: 1650, decayS: 0.035, gain: 0.26, click: 0.7 },
  loops: {
    spin: { wave: 'triangle', baseHz: 62, rangeHz: 88, noise: 0.45, tremolo: 0.35, gain: 0.058 },
    scrape: { centerHz: 2300, q: 0.7, gain: 0.14, grit: 0.55 },
    grind: { centerHz: 950, q: 2.2, ringHz: 1620, gain: 0.27 },
    charge: { wave: 'square', startHz: 90, endHz: 240, gain: 0.085, ratchetHz: 9 },
    tension: { wave: 'triangle', baseHz: 82, beatHz: 3, gain: 0.1, noise: 0.5 },
  },
};

// ---------------------------------------------------------------- B ----
export const DIRECTION_B: DirectionPalette = {
  id: 'B',
  name: 'Anime / Arcade',
  tagline: 'Estilizado, energético, legível e satisfatório',
  description: 'Soco de synth com "shing" brilhante, swooshes ressonantes e stingers musicais em maior. Cada ação tem uma assinatura clara e gostosa de repetir, como em jogo de luta arcade.',
  color: '#ffb347',
  level: 1,
  drive: 0.04,
  air: 0.28,
  impact: {
    thumpHz: 190, thumpEndHz: 56, thumpDecayS: 0.1, thumpGain: 0.62,
    snapFilter: 'highpass', snapHz: 4800, snapQ: 0.7, snapDecayS: 0.035, snapGain: 0.45,
    ringWave: 'sawtooth', ringHz: 1320, ringRatios: [1, 1.5, 2], ringDecayS: 0.16, ringGain: 0.16, ringDropSemis: 0,
  },
  whoosh: { startHz: 700, endHz: 3600, q: 3.2, lengthS: 0.2, gain: 1.25, toneWave: 'sawtooth', toneGain: 0.18, swirlHz: 22 },
  sting: { style: 'melodic', wave: 'square', rootHz: 523.25, up: [0, 4, 7, 12], down: [0, -3, -7, -12], noteS: 0.075, gain: 0.34, shimmer: 0.6 },
  ui: { wave: 'square', baseHz: 880, decayS: 0.055, gain: 0.5, click: 0.1 },
  loops: {
    spin: { wave: 'sine', baseHz: 110, rangeHz: 170, noise: 0.08, tremolo: 0.22, gain: 0.1 },
    scrape: { centerHz: 3400, q: 1.1, gain: 0.3, grit: 0.2 },
    grind: { centerHz: 2500, q: 4, ringHz: 3100, gain: 0.44 },
    charge: { wave: 'sawtooth', startHz: 220, endHz: 880, gain: 0.16, ratchetHz: 0 },
    tension: { wave: 'sawtooth', baseHz: 110, beatHz: 5, gain: 0.2, noise: 0.1 },
  },
};

// ---------------------------------------------------------------- C ----
export const DIRECTION_C: DirectionPalette = {
  id: 'C',
  name: 'Chaos / Overdrive',
  tagline: 'Agressivo, exagerado, estranho e poderoso',
  description: 'Distorção, sub-graves que despencam, clangs FM dissonantes (trítonos) e swells invertidos. Pesado e "errado" de propósito, mas cada evento continua com uma silhueta própria.',
  color: '#ff4fa3',
  level: 0.8,
  drive: 0.55,
  air: 0.2,
  impact: {
    thumpHz: 96, thumpEndHz: 30, thumpDecayS: 0.2, thumpGain: 0.9,
    snapFilter: 'lowpass', snapHz: 1700, snapQ: 1.2, snapDecayS: 0.08, snapGain: 0.8,
    ringWave: 'sawtooth', ringHz: 311, ringRatios: [1, 1.414, 2.83], ringDecayS: 0.26, ringGain: 0.22, ringDropSemis: 12,
  },
  whoosh: { startHz: 2600, endHz: 320, q: 2.2, lengthS: 0.26, gain: 0.5, toneWave: 'sawtooth', toneGain: 0.14, swirlHz: 11 },
  sting: { style: 'dissonant', wave: 'sawtooth', rootHz: 146.83, up: [0, 6, 13], down: [0, -6, -11], noteS: 0.1, gain: 0.28, shimmer: 0 },
  ui: { wave: 'sawtooth', baseHz: 620, decayS: 0.05, gain: 0.18, click: 0.3 },
  loops: {
    spin: { wave: 'sawtooth', baseHz: 48, rangeHz: 64, noise: 0.2, tremolo: 0.5, gain: 0.1 },
    scrape: { centerHz: 1250, q: 0.8, gain: 0.32, grit: 0.85 },
    grind: { centerHz: 620, q: 1.6, ringHz: 830, gain: 0.36 },
    charge: { wave: 'sawtooth', startHz: 70, endHz: 560, gain: 0.14, ratchetHz: 14 },
    tension: { wave: 'sawtooth', baseHz: 73.4, beatHz: 7, gain: 0.17, noise: 0.35 },
  },
};

export const DIRECTIONS: Readonly<Record<DirectionId, DirectionPalette>> = { A: DIRECTION_A, B: DIRECTION_B, C: DIRECTION_C };

/**
 * GDD 32: each archetype may have its own spin audio. The Lab applies the
 * same small offsets on top of every direction so the identity survives
 * whichever direction wins: Attack a bit higher and rougher, Defense lower
 * and heavier, Stamina smoother and steadier.
 */
export const ARCHETYPE_SPIN: Readonly<Record<string, { readonly pitch: number; readonly rough: number; readonly label: string }>> = {
  'attack-prototype': { pitch: 1.18, rough: 1.4, label: 'Attack' },
  'defense-prototype': { pitch: 0.8, rough: 1.0, label: 'Defense' },
  'stamina-prototype': { pitch: 1.0, rough: 0.55, label: 'Stamina' },
};

export function archetypeSpin(definitionId: string | undefined): { pitch: number; rough: number } {
  return (definitionId && ARCHETYPE_SPIN[definitionId]) || { pitch: 1, rough: 1 };
}
