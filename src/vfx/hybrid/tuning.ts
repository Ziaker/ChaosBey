// ============================================================
// HYBRID VFX — THE 36 APPROVED VALUES
// Owner's final configuration of the VFX Language Lab ("Salvar como final",
// 2026-09-26): docs/design-decisions/visual-prototypes-approval.md §3c.
// Source: prototypes/vfx-visual-concepts/src/tuning.ts.
//
// The lab let a panel mutate these at run time. The game bakes the approved
// numbers in as a frozen object: there is no panel, nothing writes to it, and
// every effect reads the same values on every run. Each value is the lab's
// multiplier on the effect code's own built-in base (the effect files carry
// those bases), so the product is exactly the absolute value the owner saw.
//
// CAMERA / TIME VALUES ARE METADATA ONLY. The owner froze the camera for this
// integration, and anything that scales time is out of scope:
//   shake              1.35  PENDING — CAMERA/VFX SHAKE INTEGRATION · OWNER FROZE CAMERA FOR THIS PASS
//   hitstop            1.2   the game's HitstopClock stays the only hitstop authority; not applied
//   dodgeSlowFactor    0.3   \ slow motion: not applied (scales time, camera timing);
//   dodgeSlowSeconds   0.45  /  the lab's Perfect Dodge slow motion is deferred
// No second shake and no bridge from VFX to the camera exist. See
// PENDING_CAMERA_AND_TIME_VALUES below and the tests that pin it.
// ============================================================

export interface HybridVfxValues {
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

export const HYBRID_VFX_APPROVED: Readonly<HybridVfxValues> = {
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

/** What every effect reads. Frozen: nothing may change an approved value at run time. */
export const TUNING: Readonly<HybridVfxValues> = Object.freeze({ ...HYBRID_VFX_APPROVED });

/** Approved values the game does NOT apply (camera frozen / time scaling out of scope). Metadata only. */
export const PENDING_CAMERA_AND_TIME_VALUES = Object.freeze({
  shake: { value: HYBRID_VFX_APPROVED.shake, status: 'PENDING — CAMERA/VFX SHAKE INTEGRATION · OWNER FROZE CAMERA FOR THIS PASS' },
  hitstop: { value: HYBRID_VFX_APPROVED.hitstop, status: 'NOT APPLIED — HitstopClock is the only hitstop authority' },
  dodgeSlowFactor: { value: HYBRID_VFX_APPROVED.dodgeSlowFactor, status: 'NOT APPLIED — slow motion scales time; deferred' },
  dodgeSlowSeconds: { value: HYBRID_VFX_APPROVED.dodgeSlowSeconds, status: 'NOT APPLIED — slow motion scales time; deferred' },
} as const);
