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

/** Seconds ahead a combatant's own velocity is projected for projectedEdgeRiskFraction — a Bey already sliding outward is in danger before its current position says so. */
export const EDGE_PROJECTION_HORIZON_S = 0.5;

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
  dashReadiness: number;
  /** 0..1: own momentum (owner, 2026-10-02): fast, sustained movement raises the top speed. */
  momentum: number;
  /** DodgeController.isAirRecoveryAvailable(): pressing Dodge right now (airborne) would trigger air recovery (GDD section 21) — see that method for why this is not privileged information. */
  airRecoveryAvailable: boolean;
  /** Current Stamina covers a Dodge's cost — the Bey's own resource bar, which a player reads off the HUD. DodgeController silently ignores a Dodge press it cannot pay for. */
  canAffordDodge: boolean;
  /**
   * Owner audit, 2026-10-04: the Circular is blocked right now (after a hit or a Clash) / the post-Clash lock ignores
   * Attack, Dodge and Jump. Both are on screen for a player (the attack simply doesn't come out); without them the AI
   * kept tapping a refused Circular every other tick (19 presses a second). Optional: absent = not locked.
   */
  circularLocked?: boolean;
  actionsLocked?: boolean;
  /**
   * DodgeController.isAirRecoveryAvailable(): this flight is a launch (a knockback put the Bey in the air), whether or
   * not the recovery can be pressed right now — since it spends the dodge, a launch with the dodge recharging is still a
   * launch (a player sees being thrown). Optional: absent = read airRecoveryAvailable.
   */
  launchedFlight?: boolean;
}

export interface PerceivedCombatant extends CombatantRawState {
  speedMps: number;
  distanceToEdgeM: number;
  directionTowardCenter: Vec2;
  edgeRiskFraction: number;
  /** edgeRiskFraction of where current velocity carries this combatant in EDGE_PROJECTION_HORIZON_S (public position/velocity only). */
  projectedEdgeRiskFraction: number;
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

/**
 * Attack states in which a Dash charge is actually live. AttackController.
 * getChargeFraction() deliberately keeps reporting the most recent Dash's
 * charge afterward (for the HUD/debug), so outside these states that value
 * is stale history, not "how charged am I now".
 */
const LIVE_DASH_CHARGE_STATES: ReadonlySet<AttackState> = new Set([AttackState.ChargingDash, AttackState.DashActive]);

export function perceiveCombatant(raw: CombatantRawState): PerceivedCombatant {
  return {
    ...raw,
    // Regression (M7 Part 2): reading the stale value made an AI whose
    // previous Dash had reached its charge target believe it was already
    // charged forever after — it never pressed Attack for a Dash again,
    // so every AI dashed exactly once per match.
    dashChargeFraction: LIVE_DASH_CHARGE_STATES.has(raw.attackState) ? raw.dashChargeFraction : 0,
    speedMps: length(raw.velocityXZ),
    distanceToEdgeM: distanceToEdgeM(raw.positionXZ),
    directionTowardCenter: directionTowardCenter(raw.positionXZ),
    edgeRiskFraction: edgeRiskFraction(raw.positionXZ, EDGE_RISK_MARGIN_M),
    projectedEdgeRiskFraction: edgeRiskFraction(
      {
        x: raw.positionXZ.x + raw.velocityXZ.x * EDGE_PROJECTION_HORIZON_S,
        z: raw.positionXZ.z + raw.velocityXZ.z * EDGE_PROJECTION_HORIZON_S,
      },
      EDGE_RISK_MARGIN_M,
    ),
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
