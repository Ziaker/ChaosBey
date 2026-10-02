// ============================================================
// CLASH — DIRECTION C "OVERDRIVE": THE APPROVED VALUES
// docs/design-decisions/clash-presentation-approval.md section 4, exact values of
// prototypes/clash-presentation-concepts/src/presentation/directions.ts (C).
// Directions A and B stay in the lab as references; they are not options.
//
// APPLIED (pure presentation): contact lean/shudder, speedlines, contact dust,
// mash pulse, resolution burst, arena light reaction, entry flash colour.
//
// NOT APPLIED, kept as metadata (the owner froze the camera for this integration,
// and nothing here scales time):
//   entry slow motion 0.3x for 0.5 s      — scales time (camera and simulation timing)
//   hitstop 0.07 s per mash event         — HitstopClock stays the only hitstop authority
//   pulse.shakeMeters 0.22                — camera shake; PENDING — CAMERA/VFX SHAKE INTEGRATION · OWNER FROZE CAMERA FOR THIS PASS
//   HUD bar style "overdrive" (320x22 px, tilted -18 degrees, glow) — the HUD is an open owner decision (A/B/C); the Clash
//     tug-of-war bar already exists in CombatHud and is neither redone nor restyled here
//   tie style (mirror / static / knockdown) — OPEN, ASK FIRST; a tie plays no tie-specific effect
// ============================================================

export interface OverdriveConfig {
  readonly neutralHex: number;
  readonly entrySnapFlash: number;
  readonly contact: { readonly leanDeg: number; readonly wobbleDeg: number; readonly wobbleHz: number };
  readonly speedlines: { readonly strength: number; readonly count: number; readonly tintWithSides: boolean };
  readonly dust: { readonly particlesPerSecond: number; readonly size: number; readonly speed: number; readonly sparkShare: number };
  readonly pulse: { readonly pulseSize: number; readonly useImpactStar: boolean };
  readonly resolution: { readonly flash: number; readonly burstRings: number; readonly sparks: number; readonly dustBurst: number };
  readonly arenaClashIntensity: { readonly active: number; readonly resolutionPeak: number };
}

export const OVERDRIVE: OverdriveConfig = Object.freeze({
  neutralHex: 0xffe066,
  entrySnapFlash: 1,
  contact: Object.freeze({ leanDeg: 15, wobbleDeg: 3.5, wobbleHz: 13 }),
  speedlines: Object.freeze({ strength: 1, count: 110, tintWithSides: true }),
  dust: Object.freeze({ particlesPerSecond: 230, size: 0.26, speed: 4.2, sparkShare: 0.28 }),
  pulse: Object.freeze({ pulseSize: 1.6, useImpactStar: true }),
  resolution: Object.freeze({ flash: 1, burstRings: 4, sparks: 50, dustBurst: 100 }),
  arenaClashIntensity: Object.freeze({ active: 1, resolutionPeak: 1 }),
});

/** Approved values the game does NOT apply. Metadata only. */
export const PENDING_CLASH_VALUES = Object.freeze({
  entrySlowMotion: { factor: 0.3, seconds: 0.5, status: 'NOT APPLIED — scales time (camera and simulation timing); deferred' },
  hitstopPerMashSeconds: { value: 0.07, status: 'NOT APPLIED — HitstopClock is the only hitstop authority' },
  shakeMeters: { value: 0.22, status: 'PENDING — CAMERA/VFX SHAKE INTEGRATION · OWNER FROZE CAMERA FOR THIS PASS' },
  hudBarStyle: { value: 'overdrive', status: 'NOT APPLIED — the HUD is an open owner decision (A/B/C); the Clash bar already exists in CombatHud' },
  tieStyle: { value: null, status: 'OPEN — ASK FIRST; a tie plays no tie-specific effect' },
} as const);

/** Dust tint scraped off each approved arena's floor at the contact (presentation-only, matched to each floor material). */
export const ARENA_CLASH_DUST_HEX = Object.freeze({ foundry: 0x6b5a4a, rift: 0x6d6480, tournament: 0xb8c0cc, fallback: 0x8c877e } as const);
