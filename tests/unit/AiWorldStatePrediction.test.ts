// ============================================================
// AI WORLD STATE — PREDICTION — UNIT TESTS (MILESTONE 7)
// Regression for the M7 part 1 review: AiDifficultyProfile.
// predictionStrength and AiPerception.predictPositionXZ existed but
// nothing consumed them — buildWorldState's directionToOpponent was always
// computed from the opponent's current position only. Verifies the
// prediction blend is now real: different predictionStrength values
// produce different targeting directions when the opponent is moving, and
// distanceToOpponentM/range-relevant facts always stay based on the
// opponent's REAL current position, never the predicted one.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { buildWorldState } from '../../src/ai/decision/WorldState';

function rawState(overrides: Partial<CombatantRawState> = {}): CombatantRawState {
  return {
    positionXZ: { x: 0, z: 0 },
    velocityXZ: { x: 0, z: 0 },
    headingRad: 0,
    grounded: true,
    attackState: AttackState.Neutral,
    dashChargeFraction: 0,
    dodgeState: DodgeState.Idle,
    driftState: DriftState.Idle,
    staminaFraction: 1,
    stabilityFraction: 1,
    isBroken: false,
    attackEnergyFraction: 1,
    ...overrides,
  };
}

describe('buildWorldState prediction blending', () => {
  it('directionToOpponent equals the current-position direction when no PredictionConfig is supplied', () => {
    const own = perceiveCombatant(rawState({ positionXZ: { x: 0, z: 0 } }));
    const movingOpponent = perceiveCombatant(rawState({ positionXZ: { x: 5, z: 0 }, velocityXZ: { x: 0, z: 5 } }));
    const world = buildWorldState(0, own, movingOpponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
    expect(world.directionToOpponent.x).toBeCloseTo(1, 5);
    expect(world.directionToOpponent.z).toBeCloseTo(0, 5);
  });

  it('directionToOpponent equals the current-position direction when predictionStrength is 0', () => {
    const own = perceiveCombatant(rawState({ positionXZ: { x: 0, z: 0 } }));
    const movingOpponent = perceiveCombatant(rawState({ positionXZ: { x: 5, z: 0 }, velocityXZ: { x: 0, z: 5 } }));
    const world = buildWorldState(0, own, movingOpponent, { state: ClashState.Idle, cooldownRemainingS: 0 }, { horizonSeconds: 0.5, strength: 0 });
    expect(world.directionToOpponent.x).toBeCloseTo(1, 5);
    expect(world.directionToOpponent.z).toBeCloseTo(0, 5);
  });

  it('directionToOpponent leans toward the predicted position as predictionStrength rises', () => {
    const own = perceiveCombatant(rawState({ positionXZ: { x: 0, z: 0 } }));
    // Moving opponent: currently straight ahead (+X), but moving fast in +Z
    // — a full-strength prediction should visibly rotate targeting away
    // from pure +X toward +Z as the predicted future position dominates.
    const movingOpponent = perceiveCombatant(rawState({ positionXZ: { x: 5, z: 0 }, velocityXZ: { x: 0, z: 20 } }));

    const noPrediction = buildWorldState(0, own, movingOpponent, { state: ClashState.Idle, cooldownRemainingS: 0 }, { horizonSeconds: 0.5, strength: 0 });
    const halfPrediction = buildWorldState(0, own, movingOpponent, { state: ClashState.Idle, cooldownRemainingS: 0 }, { horizonSeconds: 0.5, strength: 0.5 });
    const fullPrediction = buildWorldState(0, own, movingOpponent, { state: ClashState.Idle, cooldownRemainingS: 0 }, { horizonSeconds: 0.5, strength: 1 });

    // The Z component of the targeting direction should strictly increase
    // as prediction strength rises (more of the opponent's forward motion
    // gets blended in), while X strictly decreases.
    expect(halfPrediction.directionToOpponent.z).toBeGreaterThan(noPrediction.directionToOpponent.z);
    expect(fullPrediction.directionToOpponent.z).toBeGreaterThan(halfPrediction.directionToOpponent.z);
    expect(fullPrediction.directionToOpponent.x).toBeLessThan(noPrediction.directionToOpponent.x);
  });

  it('distanceToOpponentM always reflects the REAL current position, never the predicted one, regardless of predictionStrength', () => {
    const own = perceiveCombatant(rawState({ positionXZ: { x: 0, z: 0 } }));
    const movingOpponent = perceiveCombatant(rawState({ positionXZ: { x: 5, z: 0 }, velocityXZ: { x: 0, z: 50 } }));

    const noPrediction = buildWorldState(0, own, movingOpponent, { state: ClashState.Idle, cooldownRemainingS: 0 }, { horizonSeconds: 0.5, strength: 0 });
    const fullPrediction = buildWorldState(0, own, movingOpponent, { state: ClashState.Idle, cooldownRemainingS: 0 }, { horizonSeconds: 0.5, strength: 1 });

    expect(noPrediction.distanceToOpponentM).toBeCloseTo(5, 5);
    expect(fullPrediction.distanceToOpponentM).toBeCloseTo(5, 5);
  });
});
