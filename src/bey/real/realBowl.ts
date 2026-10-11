// ============================================================
// BEY REAL — THE BOWL'S GEOMETRY AND ITS PULL
// Pure numbers about the mode's funnel: how deep a stage of a given radius is (the slope the owner tuned against in the lab),
// and how hard gravity along that slope has to pull for a Bey rolling at the mode's speed to turn round on the way up. The motion model (RealMotion) and the match rules (realMatchRules) both read it, so the floor the Bey stands on and
// the pull it feels are one calculation.
// ============================================================

import { MATCH_BOWL_DEPTH_DEFAULT_M } from '../../arena/floor/ArenaFloorProfile';
import { ARENA_FLOOR_RADIUS } from '../../arena/colliders/ArenaTuning';
import type { RealModeConfig } from './RealTuning';

/** The lab drew the game's funnel (7 m deep over a 36 m floor) and played on a small stage: the slope the owner tuned against. */
const LAB_BOWL_DEPTH_M = MATCH_BOWL_DEPTH_DEFAULT_M;
/** The funnel profile is a power of the radius (h ∝ r^1.3): the exponent keeps the slope the same on a smaller stage. */
export const FUNNEL_EXPONENT = 1.3;

/** The bowl depth that gives a stage of this radius the slope the lab's stage had at the same distance from the centre. */
export function labEquivalentBowlDepthM(stageRadiusM: number): number {
  const scale = stageRadiusM / ARENA_FLOOR_RADIUS;
  return LAB_BOWL_DEPTH_M * scale ** FUNNEL_EXPONENT;
}

/**
 * The bowl's gravity (m/s² per unit of slope; per metre of height as potential energy) at "Puxão da cuba" ×1: the one under which a
 * Bey crossing the low point at the mode's rolling speed climbs the funnel up to the "Até onde sobe" share of the radius before it
 * stops and slides back (½v² = g·h there). A faster Bey needs a stronger bowl to turn round inside the same stage — that is what
 * keeps a ×5 Bey on it. The slider multiplies it; a deeper or shallower bowl changes the heights and slopes it acts on.
 */
export function naturalBowlGravity(config: Pick<RealModeConfig, 'cruiseSpeedMps' | 'stageRadiusM' | 'orbitRadiusFrac'>): number {
  const climb = labEquivalentBowlDepthM(config.stageRadiusM) * Math.max(1e-3, config.orbitRadiusFrac) ** FUNNEL_EXPONENT;
  return (0.5 * config.cruiseSpeedMps * config.cruiseSpeedMps) / Math.max(1e-6, climb);
}
