// ============================================================
// LAUNCH AI POLICY — how the AI picks its entry point and times its release
// Design doc §11 leaves this open ("AI target-selection strategy", "AI timing-quality policy"); this is the provisional
// version, kept small and deterministic: the same seed, personality and difficulty always give the same plan, and it draws
// a fixed number of values so the stream stays aligned whatever the branches. It uses a stream of its own (never the
// gameplay one), so adding the launch to a match does not move any other random draw.
//
// Target: on the AI's own half, nearer the centre the more aggressive the personality — but anywhere across that half, close
// or far, straight ahead or well out to the side (owner, 2026-10-09: "os lançamentos da IA sejam diferentes e aleatórios").
// Timing: the press misses the sweet spot by a human-like error that grows with the reaction delay and the error rate, so a
// Rookie launches worse than an Ace and nobody launches perfectly every time (GDD section 63: never omniscient); now and then
// even a good AI presses far from the sweet spot, and it lets go a beat early or late.
// ============================================================

import type { AiDifficultyProfile } from '../ai/difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../ai/personalities/AiPersonality';
import type { SeededRng } from '../rng/SeededRng';
import { clampLaunchTarget, launcherForward, type GroundPoint, type LaunchArena } from './LaunchGeometry';
import { LAUNCH_TUNING, timingQuality, type LaunchSide } from './LaunchTuning';

export const LAUNCH_AI_TUNING = {
  /** Radial share of the landing area (from the centre, on the AI's own half) for the most / least aggressive personality. */
  radialShareAggressive: 0.28,
  radialShareCautious: 0.62,
  radialJitterShare: 0.3,
  /** Smallest share of the landing area the point may take (never right on the centre line of the other launcher). */
  radialShareMin: 0.12,
  /** Sideways swing of the point round the launcher's axis (rad, ±): up to ~77°, still on its own half of the floor. */
  swingRad: 1.35,
  /** Chance of a wild press (any marker position within ±wildPressSpread) whatever the skill, and how far it can be (meter units). */
  wildPressChance: 0.22,
  wildPressSpread: 0.5,
  /** The AI lets go this long after it could (s, 0..max): the two Beys do not always leave together. */
  maxReleaseLagS: 0.3,
  /** Marker error (meter units) per second of effective reaction delay. */
  errorPerReactionS: 0.35 * LAUNCH_TUNING.markerSpeedPerS,
  /** A mistimed press (probability = error rate × difficulty): how far off the marker was (meter units). */
  missMin: 0.12,
  missMax: 0.3,
} as const;

export interface AiLaunchPlan {
  readonly target: GroundPoint;
  readonly quality: number;
  /** Extra seconds before this side's Bey leaves its launcher (0..maxReleaseLagS). */
  readonly releaseLagS: number;
}

export function planAiLaunch(side: LaunchSide, arena: LaunchArena, rng: SeededRng, personality: AiPersonality, difficulty: AiDifficultyProfile): AiLaunchPlan {
  const t = LAUNCH_AI_TUNING;
  // Eleven draws, always, in this order.
  const shareJitter = rng.nextRange(-t.radialJitterShare, t.radialJitterShare);
  const swing = rng.nextRange(-t.swingRad, t.swingRad);
  const g1 = rng.nextFloat();
  const g2 = rng.nextFloat();
  const g3 = rng.nextFloat();
  const missRoll = rng.nextFloat();
  const missSize = rng.nextRange(t.missMin, t.missMax);
  const missSign = rng.nextBool() ? 1 : -1;
  const wildRoll = rng.nextFloat();
  const wildError = rng.nextRange(-t.wildPressSpread, t.wildPressSpread);
  const lagRoll = rng.nextFloat();

  const aggression = Math.max(0, Math.min(1, personality.aggression));
  const share = Math.max(t.radialShareMin, Math.min(1, t.radialShareCautious + (t.radialShareAggressive - t.radialShareCautious) * aggression + shareJitter));
  const reach = arena.floorRadiusM * LAUNCH_TUNING.targetMaxRadiusShare * share;
  const f = launcherForward(side);
  // On its own half: from the centre, away from the launcher's forward axis, swung round by a small angle.
  const own = { x: -f.x, z: -f.z };
  const cos = Math.cos(swing);
  const sin = Math.sin(swing);
  const target = clampLaunchTarget({ x: (own.x * cos - own.z * sin) * reach, z: (own.x * sin + own.z * cos) * reach }, arena, side);

  // A near-normal error (three uniforms) scaled by how slow this AI reacts, plus the occasional real miss.
  const normalish = (g1 + g2 + g3 - 1.5) * 2;
  const sigma = personality.reactionDelaySeconds * difficulty.reactionDelayMultiplier * t.errorPerReactionS;
  const mistimeChance = Math.min(0.9, personality.errorRate * difficulty.errorRateMultiplier);
  const error = wildRoll < t.wildPressChance ? wildError : missRoll < mistimeChance ? missSign * missSize : normalish * sigma;
  const quality = timingQuality(LAUNCH_TUNING.markerSweetSpot + error);
  return { target, quality, releaseLagS: lagRoll * t.maxReleaseLagS };
}
