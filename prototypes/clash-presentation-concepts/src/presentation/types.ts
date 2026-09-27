// ============================================================
// CLASH PRESENTATION LAB — DIRECTION CONTRACT
// One "direction" is a complete visual answer to the Clash beat, so A, B
// and C can be compared as coherent wholes rather than a grab-bag of
// sliders. Every knob below lives in the EXPLORATION space the task
// hands the lab (entry, energy, pulses, resolution, winner/loser read,
// how "anime" vs "mechanical" it feels, how much the arena reacts) — none
// of it touches the FIXED rules (window/duration/formula/caps/cooldown),
// which only ever come from src/combat/clash/ and ClashHarness.
// ============================================================

export type DirectionId = 'A' | 'B' | 'C';
export type TieStyleId = 'mirror' | 'static' | 'knockdown';
export type EnergyStyle = 'arc' | 'helix' | 'vortex';
export type BannerStyle = 'quiet' | 'bold' | 'dramatic';

export interface DirectionConfig {
  readonly id: DirectionId;
  readonly name: string;
  readonly tagline: string;
  readonly blurb: string;
  /** 0 = purely mechanical, 1 = full anime — a one-line summary of where each direction sits on that spectrum, shown in the UI. */
  readonly animeVsMechanical: number;
  readonly colors: { readonly first: number; readonly second: number; readonly neutral: number };
  readonly entry: { readonly slowMoFactor: number; readonly slowMoSeconds: number; readonly snapFlash: number };
  readonly energy: { readonly style: EnergyStyle; readonly baseRadius: number; readonly swingReactivity: number };
  readonly pulse: { readonly hitstopSeconds: number; readonly shakeMeters: number; readonly pulseSize: number; readonly useImpactStar: boolean };
  readonly resolution: { readonly hitstopSeconds: number; readonly slowMoFactor: number; readonly slowMoSeconds: number; readonly burstRings: number; readonly bannerStyle: BannerStyle };
  readonly arenaClashIntensity: { readonly active: number; readonly resolutionPeak: number };
  readonly defaultTieStyle: TieStyleId;
  readonly cameraPresetSuggestion: 'A' | 'B' | 'C';
}

export interface TieStyleConfig {
  readonly id: TieStyleId;
  readonly label: string;
  readonly blurb: string;
  readonly bannerText: string;
}
