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
export type HudStyle = 'mechanical' | 'anime' | 'overdrive';

export interface DirectionConfig {
  readonly id: DirectionId;
  readonly name: string;
  readonly tagline: string;
  readonly blurb: string;
  /** 0 = purely mechanical, 1 = full anime — a one-line summary of where each direction sits on that spectrum, shown in the UI. */
  readonly animeVsMechanical: number;
  /** Neutral accent (entry flash, knockdown tie ring). The two SIDE colors are not per-direction: they are each chosen Bey model's own approved glow color, so the HUD halves, speedline tints and bursts always match the Bey they belong to. */
  readonly colors: { readonly neutral: number };
  readonly entry: { readonly slowMoFactor: number; readonly slowMoSeconds: number; readonly snapFlash: number };
  /** The locked-contact pose while the Clash is Active: both Beys lean into the contact point and shudder under the push. Visual only — physics bodies are untouched. */
  readonly contact: { readonly leanDeg: number; readonly wobbleDeg: number; readonly wobbleHz: number };
  /** Screen-space speedlines while the Clash is Active. `strength` 0..1 scales count/opacity/length; they grow with Clash progress and fade out on resolution. */
  readonly speedlines: { readonly strength: number; readonly count: number; readonly tintWithSides: boolean };
  /** Dust/grit scraped off the floor at the contact point while the Beys grind against each other. */
  readonly dust: { readonly particlesPerSecond: number; readonly size: number; readonly speed: number; readonly sparkShare: number };
  readonly hud: { readonly style: HudStyle };
  readonly pulse: { readonly hitstopSeconds: number; readonly shakeMeters: number; readonly pulseSize: number; readonly useImpactStar: boolean };
  /** Resolution is never a pause: no hitstop, no slow motion, no banner. Only the impact itself (flash, rings, sparks, dust) plays while physics carries on. */
  readonly resolution: { readonly flash: number; readonly burstRings: number; readonly sparks: number; readonly dustBurst: number };
  readonly arenaClashIntensity: { readonly active: number; readonly resolutionPeak: number };
  readonly defaultTieStyle: TieStyleId;
  readonly cameraPresetSuggestion: 'A' | 'B' | 'C';
}

export interface TieStyleConfig {
  readonly id: TieStyleId;
  readonly label: string;
  readonly blurb: string;
}
