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
import { distanceBetweenM, type PerceivedCombatant } from '../perception/AiPerception';

export interface ClashContext {
  state: ClashState;
  cooldownRemainingS: number;
}

export interface WorldState {
  readonly nowS: number;
  readonly own: PerceivedCombatant;
  readonly opponent: PerceivedCombatant;
  readonly clash: ClashContext;
  /** Straight-line distance (m) between own and opponent positions. */
  readonly distanceToOpponentM: number;
  /** Unit vector from own position toward the opponent's current position; zero vector only in the degenerate case of identical positions. */
  readonly directionToOpponent: Vec2;
  /** Own speed relative to the opponent's — positive means own is faster (used by RiskEvaluation for "a slower defender is more vulnerable", GDD section 27, from the AI's own perspective as a potential defender). */
  readonly relativeSpeedAdvantageMps: number;
}

export function buildWorldState(nowS: number, own: PerceivedCombatant, opponent: PerceivedCombatant, clash: ClashContext): WorldState {
  const toOpponent = subtract(opponent.positionXZ, own.positionXZ);
  const dist = length(toOpponent);
  return {
    nowS,
    own,
    opponent,
    clash,
    distanceToOpponentM: distanceBetweenM(own, opponent),
    directionToOpponent: dist > 1e-6 ? { x: toOpponent.x / dist, z: toOpponent.z / dist } : { x: 0, z: 0 },
    relativeSpeedAdvantageMps: own.speedMps - opponent.speedMps,
  };
}
