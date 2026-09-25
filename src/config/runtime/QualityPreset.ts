// ============================================================
// QUALITY PRESETS
// Required tiers per GDD section 55/89. Only rendering/VFX cost may scale
// with quality — simulation/collision correctness must never change
// between presets (GDD section 89).
// ============================================================

export enum QualityPreset {
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
}

export const DEFAULT_QUALITY_PRESET = QualityPreset.Medium;
