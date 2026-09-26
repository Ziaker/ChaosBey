// ============================================================
// AI WORLD STATE (MILESTONE 7)
// GDD section 62: layer 2 — aggregates this tick's own/opponent perception
// plus shared match context (Clash availability, elapsed time) into one
// immutable snapshot IntentSelection/RiskEvaluation read from. Nothing here
// mutates anything — building a WorldState is a pure read, same spirit as
// tickMatch's BeySnapshot (GDD section 1.4: telemetry/AI observe, they
// don't secretly alter gameplay).
// ============================================================

import { ClashState } from '../../combat/clash/ClashController';
import { length, subtract, type Vec2 } from '../../physics/Vec2';
import { distanceBetweenM, predictPositionXZ, type PerceivedCombatant } from '../perception/AiPerception';

export interface ClashContext {
  state: ClashState;
  cooldownRemainingS: number;
}

/**
 * How strongly targeting/steering should trust the opponent's short-horizon
 * predicted position instead of just their current one — GDD section 59/
 * 111's "prediction" difficulty axis, closing the loop AiDifficultyProfile.
 * predictionStrength and AiPerception.predictPositionXZ already existed for
 * but nothing previously consumed. 0 = react to current position only
 * (predictPositionXZ is never even called); 1 = fully trust the
 * extrapolation. Deliberately never touches distanceToOpponentM/range
 * checks below — attack range must always be judged from the opponent's
 * real current position, never a predicted one, or the AI could believe
 * itself in range when it physically is not.
 */
export interface PredictionConfig {
  readonly horizonSeconds: number;
  readonly strength: number;
}

export interface WorldState {
  readonly nowS: number;
  readonly own: PerceivedCombatant;
  readonly opponent: PerceivedCombatant;
  readonly clash: ClashContext;
  /** Straight-line distance (m) between own and the opponent's REAL current position — never blended with a prediction (see PredictionConfig doc above). */
  readonly distanceToOpponentM: number;
  /** Unit vector from own position toward the opponent's targeting position — a strength-weighted blend of their current and short-horizon-predicted position (see PredictionConfig); equals the plain current-position direction when no PredictionConfig is supplied or strength is 0. Zero vector only in the degenerate case of identical positions. */
  readonly directionToOpponent: Vec2;
  /** Own speed relative to the opponent's — positive means own is faster (used by RiskEvaluation for "a slower defender is more vulnerable", GDD section 27, from the AI's own perspective as a potential defender). */
  readonly relativeSpeedAdvantageMps: number;
}

export function buildWorldState(
  nowS: number,
  own: PerceivedCombatant,
  opponent: PerceivedCombatant,
  clash: ClashContext,
  prediction?: PredictionConfig,
): WorldState {
  const targetPositionXZ =
    prediction && prediction.strength > 0
      ? lerpVec2(opponent.positionXZ, predictPositionXZ(opponent, prediction.horizonSeconds), prediction.strength)
      : opponent.positionXZ;
  const toTarget = subtract(targetPositionXZ, own.positionXZ);
  const dist = length(toTarget);
  return {
    nowS,
    own,
    opponent,
    clash,
    distanceToOpponentM: distanceBetweenM(own, opponent),
    directionToOpponent: dist > 1e-6 ? { x: toTarget.x / dist, z: toTarget.z / dist } : { x: 0, z: 0 },
    relativeSpeedAdvantageMps: own.speedMps - opponent.speedMps,
  };
}

function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
