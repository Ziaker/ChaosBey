// ============================================================
// LAUNCH TUNING — every number of the Launch System A (Timing Snap) in one place
// Owner, 2026-10-07 (docs/design-decisions/launch-system-approval.md §8): "Implementation must centralize any
// timing-quality-to-gameplay mapping, keep it deterministic, and expose provisional numbers for playtest rather than
// scattering magic numbers." The prototype (prototypes/launch-system-concepts/index.html) fixes the feel (marker sweep,
// flight time, arc, the 0.07 s lead of the first Bey); how a timing grade changes the fight is NOT final balance
// (§8, §11) — the mapping in launchOutcomeFor() is PROVISIONAL and kept deliberately small.
// ============================================================

import { INTENDED_MAX_SPEED_MPS } from '../bey/movement/MovementTuning';

/** The two sides of a match (the same ids MatchSession uses). */
export type LaunchSide = 'first' | 'second';

export const LAUNCH_SIDES: readonly LaunchSide[] = ['first', 'second'];

export const LAUNCH_TUNING = {
  // ---- the round start (prototype: phase 'intro' → 'armed') ----
  /** Seconds the Beys sit mounted before the marker starts (the prototype's intro). */
  introHoldS: 0.85,
  /** If a person never presses LAUNCH the launchers release by themselves after this long armed (an unattended window, tests). */
  armedTimeoutS: 15,
  /** A side nobody drives (AI-only rounds, scripted/idle sides) releases this long after the marker starts. */
  autoReleaseAfterArmedS: 0.6,

  // ---- Timing Snap marker (prototype: wave = (t × 0.68) % 2, triangle) ----
  /** Marker travel in launch-meter units per second (0..1 and back: a full sweep and return takes 2 / this). */
  markerSpeedPerS: 0.68,
  /** Where the ideal window is on the 0..1 meter. */
  markerSweetSpot: 0.78,
  /** Distance from the sweet spot at which the quality reaches 0. */
  markerWindowHalfWidth: 0.34,
  /** Quality at or above which a launch reads PERFECT / STRONG / CLEAN (below: WEAK). */
  gradePerfectAt: 0.93,
  gradeStrongAt: 0.75,
  gradeCleanAt: 0.5,

  // ---- the entry point (prototype: LS_TARGET_RADIUS 29 of the 36 m floor; default drop 8.5 m in front of the centre) ----
  /** Farthest a Bey may be sent, as a share of the floor radius (29 / 36). */
  targetMaxRadiusShare: 29 / 36,
  /** The entry point a side starts with: this share of the floor radius toward its own launcher (8.5 / 36). */
  targetDefaultShare: 8.5 / 36,
  /** How fast the keys / the stick move the entry point, in floor radii per second at full tilt. */
  targetMoveRadiiPerS: 0.45,
  /** Two Beys never land closer than this many Bey diameters (the AI's point yields: the person's choice wins). */
  minLandingSeparationBeyDiameters: 1.6,

  // ---- the launchers (prototype: LS_Launcher at z = ±29.5 on a 36 m floor, socket 3.7 m up) ----
  launcherRadiusShare: 29.5 / 36,
  launcherBaseLiftM: 0.05,
  /** The socket the Bey sits in, in the launcher's own frame (x right, y up, z forward = toward the entry point): on the head, at the back, exactly as in the approved prototype (LS_Launcher.socket). */
  socketLocalM: { x: 0, y: 3.7, z: -1.18 },

  // ---- release and flight (prototype: updateFlight) ----
  /** The flight time of a perfect launch / a zero-quality one (power 1 / 0.44). */
  flightBaseS: 0.64,
  flightExtraForLowPowerS: 0.18,
  /** The AI Bey leaves this long after the person's (the dual arrival is slightly staggered, as in the prototype). */
  secondLeadS: 0.07,
  /** Arc height over the straight line: first side = base + power × gain; the other side a fixed height. */
  arcBaseM: 4.4,
  arcPowerGainM: 3.8,
  arcOtherSideM: 6.3,
  /** Seconds after the release that the camera/launcher treat the flight as 'in the air' rather than 'release'. */
  releasePhaseS: 0.11,

  // ---- what the grade does (PROVISIONAL, §8) ----
  /** Entry speed on arrival (m/s): × the Bey's intended top speed, from a zero-quality to a perfect launch. */
  entrySpeedShareWeak: 0.35,
  entrySpeedShareStrong: 1,
  /** The first contact is a small bounce, not a stop: upward speed on arrival (m/s). */
  arrivalBounceMps: 1.6,
  /** Seconds the Bey's visual spin is slow while mounted vs. launched (rad/s; render only). */
  mountedSpinRadPerS: 7,
} as const;

/** What a launch grade is worth. Everything here is provisional playtest material (§8), computed in one place. */
export interface LaunchOutcome {
  /** 0..1: how close the press was to the sweet spot. */
  readonly quality: number;
  /** 0..1 prototype readouts (not final balance). */
  readonly power: number;
  readonly spin: number;
  readonly control: number;
  /** Horizontal speed the Bey lands with, toward the arena (m/s). */
  readonly entrySpeedMps: number;
  /** Flight duration (s). */
  readonly flightS: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Quality of a press with the marker at `marker` (0..1): 1 on the sweet spot, falling to 0 at the window's edge. */
export function timingQuality(marker: number): number {
  return clamp01(1 - Math.abs(marker - LAUNCH_TUNING.markerSweetSpot) / LAUNCH_TUNING.markerWindowHalfWidth);
}

/** The marker's position `armedTicks` ticks after it started (a triangle wave 0 → 1 → 0). */
export function markerAt(armedSeconds: number): number {
  const wave = (Math.max(0, armedSeconds) * LAUNCH_TUNING.markerSpeedPerS) % 2;
  return wave <= 1 ? wave : 2 - wave;
}

export type LaunchGrade = 'PERFECT' | 'STRONG' | 'CLEAN' | 'WEAK';

export function launchGrade(quality: number): LaunchGrade {
  const t = LAUNCH_TUNING;
  return quality >= t.gradePerfectAt ? 'PERFECT' : quality >= t.gradeStrongAt ? 'STRONG' : quality >= t.gradeCleanAt ? 'CLEAN' : 'WEAK';
}

/** The single timing-quality → launch result mapping (design doc §8). Deterministic, pure. */
export function launchOutcomeFor(quality: number): LaunchOutcome {
  const t = LAUNCH_TUNING;
  const q = clamp01(quality);
  const power = 0.44 + q * 0.56;
  return {
    quality: q,
    power,
    spin: 0.48 + q * 0.52,
    control: 0.68 + q * 0.32,
    entrySpeedMps: INTENDED_MAX_SPEED_MPS * (t.entrySpeedShareWeak + (t.entrySpeedShareStrong - t.entrySpeedShareWeak) * q),
    flightS: t.flightBaseS + (1 - power) * t.flightExtraForLowPowerS,
  };
}
