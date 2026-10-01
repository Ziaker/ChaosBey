// ============================================================
// CONDITION VISUALS — THE 49 APPROVED VALUES
// Owner's final configuration (Stamina & Stability Lab, "Salvar como final"
// 2026-09-27, minus C's red light column which the owner removed afterwards).
// Source: prototypes/condition-visual-concepts/src/tuning.ts and
// docs/design-decisions/condition-visual-approval.md section 10. Units:
// multipliers (1 = the lab's original proposal) unless a name says otherwise.
//
// Which of the shared "physics" values the game uses:
//   USED (pure display, derived from Stamina / Stability / Broken):
//     spinMaxRps, spinMinRps, spinCurve, meshMaxRps, blur, blurFadeRps,
//     wobbleStart, brokenStutter, spinOutSeconds (the collapse of the drawn spin)
//   KEPT AS APPROVED REFERENCE, NOT APPLIED: the lab's motion was choreography.
//     The game's attitude (tilt, wobble, tumble, knockback) comes from the real
//     SpinController and physics, which are the only movement authority
//     (condition-visual-approval.md section 2 note, GDD 83/84). So precessionHz,
//     nutation, tipWander, stabilityWobble, wobbleMaxDeg, hitTiltDeg, knockback,
//     recoverySpeed, brokenLeanDeg and hitTiltFull are never written to a pose.
// ============================================================

export interface ConditionTuning {
  // --- Shared physical expression (every direction) ---
  spinMaxRps: number;
  spinMinRps: number;
  spinCurve: number;
  meshMaxRps: number;
  blur: number;
  blurFadeRps: number;
  wobbleStart: number;
  wobbleMaxDeg: number;
  precessionHz: number;
  nutation: number;
  tipWander: number;
  stabilityWobble: number;
  hitTiltDeg: number;
  hitTiltFull: number;
  knockback: number;
  recoverySpeed: number;
  brokenLeanDeg: number;
  brokenStutter: number;
  spinOutSeconds: number;

  // --- A: Mechanical wear ---
  aTrail: number;
  aTrailSeconds: number;
  aRattle: number;
  aSeamGap: number;
  aWear: number;
  aGrind: number;
  aSmoke: number;
  aShudder: number;
  aDebris: number;

  // --- B: Spirit aura ---
  bAuraHeight: number;
  bAuraIntensity: number;
  bAuraBreakup: number;
  bSpinLines: number;
  bShards: number;
  bShardSize: number;
  bShardOrbit: number;
  bDangerShell: number;
  bDangerHz: number;
  bDazed: number;
  bArcs: number;
  bGlowDim: number;

  // --- C: Floor instrument ---
  cRadius: number;
  cWidth: number;
  cOpacity: number;
  cSegments: number;
  cWarnAt: number;
  cCritAt: number;
  cNotch: number;
  cCorePulse: number;
  cHazardSpin: number;
}

export const CONDITION_TUNING_APPROVED: Readonly<ConditionTuning> = {
  spinMaxRps: 18,
  spinMinRps: 1.2,
  spinCurve: 1.6,
  meshMaxRps: 3.5,
  blur: 1,
  blurFadeRps: 6,
  wobbleStart: 0.55,
  wobbleMaxDeg: 16,
  precessionHz: 0.9,
  nutation: 1,
  tipWander: 1,
  stabilityWobble: 1,
  hitTiltDeg: 26,
  hitTiltFull: 0.3,
  knockback: 1,
  recoverySpeed: 3,
  brokenLeanDeg: 11,
  brokenStutter: 0.5,
  spinOutSeconds: 3,

  aTrail: 0.55,
  aTrailSeconds: 3.6,
  aRattle: 0.5,
  aSeamGap: 1.8,
  aWear: 1.65,
  aGrind: 2.35,
  aSmoke: 2.4,
  aShudder: 1,
  aDebris: 2.35,

  bAuraHeight: 0.4,
  bAuraIntensity: 0.25,
  bAuraBreakup: 1.5,
  bSpinLines: 1.3,
  bShards: 6,
  bShardSize: 1,
  bShardOrbit: 0.9,
  bDangerShell: 0,
  bDangerHz: 2.2,
  bDazed: 1.6,
  bArcs: 1.85,
  bGlowDim: 0.8,

  cRadius: 1.15,
  cWidth: 0.95,
  cOpacity: 0.6,
  cSegments: 10,
  cWarnAt: 0.35,
  cCritAt: 0.23,
  cNotch: 0.85,
  cCorePulse: 1.25,
  cHazardSpin: 1.15,
};

/** The shared values the game applies as display (see the header). */
export const CONDITION_DISPLAY_KEYS = ['spinMaxRps', 'spinMinRps', 'spinCurve', 'meshMaxRps', 'blur', 'blurFadeRps', 'wobbleStart', 'brokenStutter', 'spinOutSeconds'] as const satisfies readonly (keyof ConditionTuning)[];

/** Shared values kept only as the approved reference; no pose is ever driven by them. */
export const CONDITION_REFERENCE_ONLY_KEYS = ['wobbleMaxDeg', 'precessionHz', 'nutation', 'tipWander', 'stabilityWobble', 'hitTiltDeg', 'knockback', 'recoverySpeed', 'brokenLeanDeg', 'hitTiltFull'] as const satisfies readonly (keyof ConditionTuning)[];
