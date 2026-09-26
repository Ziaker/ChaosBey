// ============================================================
// AI PERCEPTION (MILESTONE 7)
// GDD section 62: layer 1 of the AI's conceptual pipeline (perception ->
// world state -> risk evaluation -> intent -> action selection -> controller
// output). Builds a read-only, per-combatant perceived state from exactly
// the same data a spectator/player already has access to — position,
// velocity, heading, grounded state, and each system's own public
// snapshot/state getters (AttackController.getState(), DodgeController.
// getState(), etc.) — never anything hidden or privileged (GDD/owner rule:
// the AI must obey the same rules as a player, no reading inaccessible
// state as a cheat).
//
// Deliberately takes primitives rather than a live Bey/RAPIER handle so
// this stays pure and unit-testable without physics (AIController.ts is
// the thin adapter that extracts these primitives from a real Bey).
// ============================================================

import { AttackState } from '../../combat/attacks/AttackController';
import { DodgeState } from '../../dodge/DodgeController';
import { DriftState } from '../../drift/DriftController';
import { length, subtract, type Vec2 } from '../../physics/Vec2';
import { directionTowardCenter, distanceToEdgeM, edgeRiskFraction } from './EdgeAwareness';

/** How far from the ring-out boundary edge-risk starts ramping up (GDD section 129 — must give the AI enough room to actually attempt recovery, not just notice the edge a tick before falling off it). */
export const EDGE_RISK_MARGIN_M = 3.5;

export interface CombatantRawState {
  positionXZ: Vec2;
  velocityXZ: Vec2;
  headingRad: number;
  grounded: boolean;
  attackState: AttackState;
  dashChargeFraction: number;
  dodgeState: DodgeState;
  driftState: DriftState;
  staminaFraction: number;
  stabilityFraction: number;
  isBroken: boolean;
  attackEnergyFraction: number;
}

export interface PerceivedCombatant extends CombatantRawState {
  speedMps: number;
  distanceToEdgeM: number;
  directionTowardCenter: Vec2;
  edgeRiskFraction: number;
  /** True while this combatant currently has a live/imminent hitbox that could land soon — mirrors ClashOrchestration's ENGAGED_ATTACK_STATES notion of "threatening", reused here for the AI's own read of danger rather than duplicating the list. */
  hasImminentHitbox: boolean;
}

/**
 * Attack states with a live or imminent hitbox. Exported (not just used
 * internally) so AIController.ts can reuse the exact same set to recognize
 * "I am myself mid-attack right now" — a single definition of "engaged",
 * never two lists that could silently drift apart.
 */
export const ENGAGED_ATTACK_STATES: ReadonlySet<AttackState> = new Set([
  AttackState.Buffering,
  AttackState.ChargingDash,
  AttackState.CircularActive,
  AttackState.DashActive,
]);

export function perceiveCombatant(raw: CombatantRawState): PerceivedCombatant {
  return {
    ...raw,
    speedMps: length(raw.velocityXZ),
    distanceToEdgeM: distanceToEdgeM(raw.positionXZ),
    directionTowardCenter: directionTowardCenter(raw.positionXZ),
    edgeRiskFraction: edgeRiskFraction(raw.positionXZ, EDGE_RISK_MARGIN_M),
    hasImminentHitbox: ENGAGED_ATTACK_STATES.has(raw.attackState),
  };
}

/** Straight-line distance (m) between two combatants' positions. */
export function distanceBetweenM(a: PerceivedCombatant, b: PerceivedCombatant): number {
  return length(subtract(a.positionXZ, b.positionXZ));
}

/**
 * Short-horizon linear extrapolation of a combatant's future position from
 * its current velocity — the only "prediction" this AI does (GDD section
 * 59/111: difficulty modulates how strongly this is trusted, never
 * omniscient future knowledge; see AiDifficultyProfile.predictionStrength).
 */
export function predictPositionXZ(combatant: PerceivedCombatant, horizonSeconds: number): Vec2 {
  return {
    x: combatant.positionXZ.x + combatant.velocityXZ.x * horizonSeconds,
    z: combatant.positionXZ.z + combatant.velocityXZ.z * horizonSeconds,
  };
}
