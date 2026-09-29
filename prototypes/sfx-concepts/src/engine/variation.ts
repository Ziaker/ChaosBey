// ============================================================
// SFX LAB — DETERMINISTIC VARIATION (no machine-gun repeats)
// A frequent sound (hits, contacts, mash…) must not repeat the exact same
// waveform every time, but it must stay instantly recognizable. Each play
// gets a small, controlled nudge of pitch, level and length and a layer
// pick that never repeats back to back. The nudges come from a seeded
// counter per (event, side), so the same sequence of plays always gets the
// same variations: reproducible listening, reproducible tests.
//
// Ranges per event are tuning, not approved values.
// ============================================================

export interface VariationRange {
  /** ± cents of pitch (100 cents = 1 semitone). */
  readonly pitchCents: number;
  /** ± dB of level. */
  readonly gainDb: number;
  /** ± fraction of length (0.1 = ±10%). */
  readonly lengthPct: number;
  /** How many alternative layers the recipe can pick from. */
  readonly layers: number;
}

const NONE: VariationRange = { pitchCents: 0, gainDb: 0, lengthPct: 0, layers: 1 };
const SUBTLE: VariationRange = { pitchCents: 20, gainDb: 0.6, lengthPct: 0.04, layers: 1 };
const FREQUENT: VariationRange = { pitchCents: 70, gainDb: 1.5, lengthPct: 0.1, layers: 3 };
const VERY_FREQUENT: VariationRange = { pitchCents: 110, gainDb: 2, lengthPct: 0.12, layers: 3 };

/** Frequent physical events vary most; one-off moments and UI stay stable (they are signals). */
export const VARIATION_BY_EVENT: Readonly<Record<string, VariationRange>> = {
  beyContact: VERY_FREQUENT,
  wallImpact: FREQUENT,
  landing: FREQUENT,
  hit: FREQUENT,
  clashMash: VERY_FREQUENT,
  circularStart: FREQUENT,
  dashRelease: FREQUENT,
  dodge: FREQUENT,
  dodged: SUBTLE,
  jump: FREQUENT,
  counter: SUBTLE,
  dashFull: NONE,
  perfectDodge: SUBTLE,
  stabilityBreak: SUBTLE,
  stabilityRecover: NONE,
  staminaLow: NONE,
  energyEmpty: NONE,
  clashStart: SUBTLE,
  clashResolve: SUBTLE,
  clashTie: NONE,
  roundStart: NONE,
  ringOut: SUBTLE,
  ko: SUBTLE,
  victory: NONE,
  defeat: NONE,
  draw: NONE,
  uiFocus: { pitchCents: 8, gainDb: 0.4, lengthPct: 0, layers: 1 },
  uiConfirm: NONE,
  uiBack: NONE,
  uiError: NONE,
};

export function variationRangeFor(eventId: string): VariationRange {
  return VARIATION_BY_EVENT[eventId] ?? NONE;
}

export interface Variation {
  /** Pitch multiplier (1 = unchanged). */
  readonly pitch: number;
  /** Level multiplier (1 = unchanged). */
  readonly gain: number;
  /** Length multiplier (1 = unchanged). */
  readonly length: number;
  /** Layer index in [0, layers). */
  readonly layer: number;
  /** A 32-bit seed recipes may use for their own noise/detail. */
  readonly seed: number;
}

export const NEUTRAL_VARIATION: Variation = { pitch: 1, gain: 1, length: 1, layer: 0, seed: 1 };

/** FNV-1a 32-bit. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a tiny, good-enough deterministic generator in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeVariation(range: VariationRange, seed: number, previousLayer: number | null): Variation {
  const random = mulberry32(seed);
  const signed = () => random() * 2 - 1;
  const pitch = Math.pow(2, (signed() * range.pitchCents) / 1200);
  const gain = Math.pow(10, (signed() * range.gainDb) / 20);
  const length = 1 + signed() * range.lengthPct;
  let layer = range.layers > 1 ? Math.floor(random() * range.layers) : 0;
  // Never the same layer twice in a row when there is a choice.
  if (range.layers > 1 && previousLayer !== null && layer === previousLayer) layer = (layer + 1) % range.layers;
  return { pitch, gain, length, layer, seed: Math.floor(random() * 0xffffffff) >>> 0 };
}

/** One counter per (event, key): the n-th play of an event always gets the same variation. */
export class VariationSource {
  private readonly counters = new Map<string, number>();
  private readonly lastLayers = new Map<string, number>();

  constructor(private readonly baseSeed = 0x5f3759df) {}

  next(eventId: string, key = ''): Variation {
    const slot = `${eventId}|${key}`;
    const count = this.counters.get(slot) ?? 0;
    this.counters.set(slot, count + 1);
    const variation = makeVariation(variationRangeFor(eventId), hashString(`${this.baseSeed}|${slot}|${count}`), this.lastLayers.get(slot) ?? null);
    this.lastLayers.set(slot, variation.layer);
    return variation;
  }

  reset(): void {
    this.counters.clear();
    this.lastLayers.clear();
  }
}
