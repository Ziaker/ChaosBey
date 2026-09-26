// ============================================================
// VFX LAB — LIVE TUNING
// Every adjustable effect parameter in one place. The lab's tuning panel
// edits TUNING live; languages read it at event time, so changes apply on
// the next effect without rebuilding. APPROVED holds the current approved
// values (owner decisions so far); "Save as final" in the page stores the
// owner's chosen values so they can be read back and moved into the game.
// All values are multipliers (1 = approved) unless the label says otherwise.
// ============================================================

export interface TuningSpec {
  readonly key: keyof Tuning;
  readonly group: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface Tuning {
  // Global feel
  shake: number;
  hitstop: number;
  flash: number;
  focusLines: number;
  impactFrameMin: number;
  impactFrameLength: number;
  // Contact & speed sparks (from A)
  contactSparks: number;
  sparkSpeed: number;
  sparkLife: number;
  chips: number;
  dust: number;
  scuffs: number;
  speedSparks: number;
  skidMarks: number;
  // Hit (from B)
  starSize: number;
  shockwave: number;
  sparkLines: number;
  // Dash & trail (from B)
  chargeAura: number;
  trailWidth: number;
  trailLife: number;
  // Perfect Dodge (from B)
  dodgeSlowFactor: number;
  dodgeSlowSeconds: number;
  dodgeTint: number;
  afterimageOpacity: number;
  // Wind burst (Cel Cyclone)
  windRings: number;
  windRingSize: number;
  windRingLife: number;
  windRingDrift: number;
  windStreaks: number;
  windStreakWidth: number;
  windStreakOpacity: number;
  windStreakLength: number;
  windSpiralLines: number;
  windSpiralOpacity: number;
  windDust: number;
  windDebris: number;
}

/** FINAL values chosen by the owner in the lab's tuning panel (2026-09-26).
 * Multipliers are relative to the effect code's built-in base values. */
export const APPROVED: Readonly<Tuning> = {
  shake: 1.35,
  hitstop: 1.2,
  flash: 1.25,
  focusLines: 1.05,
  impactFrameMin: 0.65,
  impactFrameLength: 0.6,
  contactSparks: 1,
  sparkSpeed: 1,
  sparkLife: 1,
  chips: 1,
  dust: 1,
  scuffs: 1,
  speedSparks: 1,
  skidMarks: 1,
  starSize: 0.9,
  shockwave: 1.95,
  sparkLines: 3,
  chargeAura: 1.95,
  trailWidth: 0.55,
  trailLife: 3,
  dodgeSlowFactor: 0.3,
  dodgeSlowSeconds: 0.45,
  dodgeTint: 0.12,
  afterimageOpacity: 0.25,
  windRings: 1,
  windRingSize: 0.65,
  windRingLife: 0.71,
  windRingDrift: 2.25,
  windStreaks: 0.7,
  windStreakWidth: 0.15,
  windStreakOpacity: 0.6,
  windStreakLength: 3,
  windSpiralLines: 3,
  windSpiralOpacity: 0.5,
  windDust: 1.65,
  windDebris: 2.6,
};

/** Live values (mutated by the tuning panel). */
export const TUNING: Tuning = { ...APPROVED };

export const TUNING_SPEC: readonly TuningSpec[] = [
  { key: 'shake', group: 'Global feel', label: 'Camera shake', min: 0, max: 2.5, step: 0.05 },
  { key: 'hitstop', group: 'Global feel', label: 'Hitstop length', min: 0, max: 2.5, step: 0.05 },
  { key: 'flash', group: 'Global feel', label: 'Light flash', min: 0, max: 2.5, step: 0.05 },
  { key: 'focusLines', group: 'Global feel', label: 'Focus / speed lines', min: 0, max: 2, step: 0.05 },
  { key: 'impactFrameMin', group: 'Global feel', label: 'Impact frame from intensity (0–1, >1 = off)', min: 0, max: 1.05, step: 0.05 },
  { key: 'impactFrameLength', group: 'Global feel', label: 'Impact frame length', min: 0.3, max: 3, step: 0.05 },

  { key: 'contactSparks', group: 'Contact sparks (A)', label: 'Spark amount', min: 0, max: 3, step: 0.05 },
  { key: 'sparkSpeed', group: 'Contact sparks (A)', label: 'Spark speed', min: 0.3, max: 2, step: 0.05 },
  { key: 'sparkLife', group: 'Contact sparks (A)', label: 'Spark lifetime', min: 0.3, max: 2.5, step: 0.05 },
  { key: 'chips', group: 'Contact sparks (A)', label: 'Metal chips', min: 0, max: 3, step: 0.05 },
  { key: 'dust', group: 'Contact sparks (A)', label: 'Dust puffs', min: 0, max: 3, step: 0.05 },
  { key: 'scuffs', group: 'Contact sparks (A)', label: 'Floor scuff marks', min: 0, max: 1.5, step: 0.05 },
  { key: 'speedSparks', group: 'Contact sparks (A)', label: 'High-speed sparks', min: 0, max: 3, step: 0.05 },
  { key: 'skidMarks', group: 'Contact sparks (A)', label: 'Skid marks', min: 0, max: 2, step: 0.05 },

  { key: 'starSize', group: 'Hit (B)', label: 'Impact star size', min: 0, max: 2, step: 0.05 },
  { key: 'shockwave', group: 'Hit (B)', label: 'Shockwave ring size', min: 0, max: 2, step: 0.05 },
  { key: 'sparkLines', group: 'Hit (B)', label: 'Spark lines', min: 0, max: 3, step: 0.05 },

  { key: 'chargeAura', group: 'Dash & trail (B)', label: 'Charge aura', min: 0, max: 2, step: 0.05 },
  { key: 'trailWidth', group: 'Dash & trail (B)', label: 'Energy trail width', min: 0, max: 2.5, step: 0.05 },
  { key: 'trailLife', group: 'Dash & trail (B)', label: 'Energy trail length', min: 0.2, max: 3, step: 0.05 },

  { key: 'dodgeSlowFactor', group: 'Perfect Dodge (B)', label: 'Slow motion speed (1 = none)', min: 0.05, max: 1, step: 0.05 },
  { key: 'dodgeSlowSeconds', group: 'Perfect Dodge (B)', label: 'Slow motion seconds', min: 0, max: 2, step: 0.05 },
  { key: 'dodgeTint', group: 'Perfect Dodge (B)', label: 'Blue tint strength', min: 0, max: 0.6, step: 0.02 },
  { key: 'afterimageOpacity', group: 'Perfect Dodge (B)', label: 'Afterimage opacity', min: 0, max: 1, step: 0.05 },

  { key: 'windRings', group: 'Wind burst (Cel Cyclone)', label: 'Ring count', min: 0, max: 5, step: 1 },
  { key: 'windRingSize', group: 'Wind burst (Cel Cyclone)', label: 'Ring size', min: 0.3, max: 2.5, step: 0.05 },
  { key: 'windRingLife', group: 'Wind burst (Cel Cyclone)', label: 'Ring duration (s)', min: 0.15, max: 1.5, step: 0.01 },
  { key: 'windRingDrift', group: 'Wind burst (Cel Cyclone)', label: 'Ring drift backward', min: 0, max: 3, step: 0.05 },
  { key: 'windStreaks', group: 'Wind burst (Cel Cyclone)', label: 'Wind line count', min: 0, max: 1.5, step: 0.05 },
  { key: 'windStreakWidth', group: 'Wind burst (Cel Cyclone)', label: 'Wind line width', min: 0.1, max: 2, step: 0.05 },
  { key: 'windStreakOpacity', group: 'Wind burst (Cel Cyclone)', label: 'Wind line opacity', min: 0, max: 1, step: 0.05 },
  { key: 'windStreakLength', group: 'Wind burst (Cel Cyclone)', label: 'Wind line length', min: 0.2, max: 3, step: 0.05 },
  { key: 'windSpiralLines', group: 'Wind burst (Cel Cyclone)', label: 'Spiral lines', min: 0, max: 8, step: 1 },
  { key: 'windSpiralOpacity', group: 'Wind burst (Cel Cyclone)', label: 'Spiral opacity', min: 0, max: 1, step: 0.05 },
  { key: 'windDust', group: 'Wind burst (Cel Cyclone)', label: 'Dust clouds', min: 0, max: 3, step: 0.05 },
  { key: 'windDebris', group: 'Wind burst (Cel Cyclone)', label: 'Debris', min: 0, max: 3, step: 0.05 },
];

/** Replace live values with `values` (unknown keys ignored, out-of-range values clamped). */
export function applyTuning(values: Partial<Record<string, unknown>>): void {
  for (const spec of TUNING_SPEC) {
    const v = values[spec.key];
    if (typeof v === 'number' && Number.isFinite(v)) TUNING[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
  }
}

export function resetTuning(): void {
  Object.assign(TUNING, APPROVED);
}
