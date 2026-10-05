// ============================================================
// VFX INTENSITY TIERS
// The approved VFX lab's three intensities (prototypes/vfx-visual-concepts,
// src/main.ts: Light 0.3, Medium 0.62, Heavy 1.0). The game maps its real
// magnitudes onto the same 0..1 scale, so these are the reference points.
// ============================================================

export const VFX_LIGHT = 0.3;
export const VFX_MEDIUM = 0.62;
export const VFX_HEAVY = 1;

// ------------------------------------------------------------
// Owner, 2026-10-02 (Lote 7, items 7/15) + audit J1/J4 (2026-10-03).
// ------------------------------------------------------------

/** Damage edges between the tiers (Stability actually applied by the hit or body collision). PROVISIONAL. */
export const HIT_DAMAGE_MEDIUM_FROM = 10;
export const HIT_DAMAGE_HEAVY_FROM = 18;
/** Half-width (damage points) of the smooth blend around each edge. PROVISIONAL. */
export const HIT_DAMAGE_BLEND = 2;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A hit's VFX magnitude from the damage it really did (after Attack/Defense, speed, angle — the resolved Stability
 * damage), on the lab's tiers: < 10 Light, 10-18 Medium, > 18 Heavy, blended smoothly over ±2 around each edge.
 * The camera keeps its own knockback-based magnitude (frozen).
 */
export function hitMagnitudeFromDamage(damage: number): number {
  return VFX_LIGHT
    + (VFX_MEDIUM - VFX_LIGHT) * smoothstep(HIT_DAMAGE_MEDIUM_FROM - HIT_DAMAGE_BLEND, HIT_DAMAGE_MEDIUM_FROM + HIT_DAMAGE_BLEND, damage)
    + (VFX_HEAVY - VFX_MEDIUM) * smoothstep(HIT_DAMAGE_HEAVY_FROM - HIT_DAMAGE_BLEND, HIT_DAMAGE_HEAVY_FROM + HIT_DAMAGE_BLEND, damage);
}

/** Ground-wave (shockwave ring) scale at magnitude 0; it grows to 1 at Medium and stays 1 above (the lab's size). PROVISIONAL. */
export const ROUTINE_GROUND_WAVE_MIN_SCALE = 0.3;

/** Owner: the ground wave was too big for small impacts — below Medium its rings shrink, Medium and up stay the lab's. */
export function groundWaveScale(m: number): number {
  if (m >= VFX_MEDIUM) return 1;
  return ROUTINE_GROUND_WAVE_MIN_SCALE + (1 - ROUTINE_GROUND_WAVE_MIN_SCALE) * Math.max(0, m) / VFX_MEDIUM;
}

/** A landing from the Bey's own hop/jump (no hit or launch in that flight) is capped this low: a small ring, no crack. PROVISIONAL. */
export const OWN_JUMP_LANDING_MAX_M = 0.12;

/** Persistent floor scars: a Heavy hit or a launched landing at/above Medium leaves one. PROVISIONAL. */
export const FLOOR_SCAR_HIT_MIN_M = 0.9;
export const FLOOR_SCAR_LANDING_MIN_M = VFX_MEDIUM;
export const FLOOR_SCAR_MAX_COUNT = 10;
export const FLOOR_SCAR_LIFE_S = 14;
/** Fraction of the life held fully visible before the fade. */
export const FLOOR_SCAR_HOLD = 0.8;

/**
 * Owner, 2026-10-02 (Lote 9, item 20): the Pregame's visual options. Presentation only — never in MatchConfig, the
 * replay or the state hash (they change no outcome). 1 = the approved look.
 */
export interface VfxOptions {
  /** Scales every effect's magnitude (size/amount), 0..1.5. */
  readonly intensity: number;
  /** Scales the ground-wave (shockwave ring) size, 0 = none. */
  readonly groundWaves: number;
  /** Scales the dust amount, 0 = none. */
  readonly dust: number;
  /**
   * Owner, 2026-10-05 ("adicione um slider pra isso também"): × the size of every effect, on top of the Bey size they
   * already follow (MatchConfig.beySizeScale). 1 = the approved sizes. Optional for older saved setups (absent = 1).
   */
  readonly effectSize?: number;
}
export const DEFAULT_VFX_OPTIONS: VfxOptions = { intensity: 1, groundWaves: 1, dust: 1, effectSize: 1 };
export const VFX_EFFECT_SIZE_RANGE = { min: 0.5, max: 2, step: 0.05 } as const;

/**
 * The size every effect of a Bey is drawn at (owner, 2026-10-05): its in-match size (MatchConfig.beySizeScale, carried
 * on the definition) × the Pregame's effects size. 1 = the approved sizes. Presentation only.
 */
export function effectScaleOf(gameplay: { readonly sizeScale?: number }, vfx?: Pick<VfxOptions, 'effectSize'> | null): number {
  return (gameplay.sizeScale ?? 1) * (vfx?.effectSize ?? 1);
}
export const VFX_INTENSITY_RANGE = { min: 0, max: 1.5, step: 0.05 } as const;
export const VFX_GROUND_WAVES_RANGE = { min: 0, max: 1.5, step: 0.05 } as const;
export const VFX_DUST_RANGE = { min: 0, max: 1.5, step: 0.05 } as const;
