// ============================================================
// AI PERCEPTION + RISK — UNIT TESTS (MILESTONE 7)
// Pure functions, no physics: edge-awareness geometry, perceiveCombatant's
// derived fields, and evaluateRisk's scoring (GDD section 62 layers 1/3).
// ============================================================

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { directionTowardCenter, distanceToEdgeM, edgeRiskFraction } from '../../src/ai/perception/EdgeAwareness';
import { perceiveCombatant, predictPositionXZ, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { evaluateRisk } from '../../src/ai/decision/RiskEvaluation';
import { buildWorldState } from '../../src/ai/decision/WorldState';
import { ClashState } from '../../src/combat/clash/ClashController';
import { DEFAULT_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';

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

describe('EdgeAwareness', () => {
  it('reports full remaining distance at the arena center', () => {
    expect(distanceToEdgeM({ x: 0, z: 0 })).toBeCloseTo(RINGOUT_RADIUS_M, 5);
  });

  it('reports negative remaining distance once past the boundary', () => {
    expect(distanceToEdgeM({ x: 0, z: RINGOUT_RADIUS_M + 1 })).toBeCloseTo(-1, 5);
  });

  it('directionTowardCenter always points back toward the origin', () => {
    const dir = directionTowardCenter({ x: 5, z: 0 });
    expect(dir.x).toBeCloseTo(-1, 5);
    expect(dir.z).toBeCloseTo(0, 5);
  });

  it('directionTowardCenter is the zero vector exactly at the center', () => {
    const dir = directionTowardCenter({ x: 0, z: 0 });
    expect(dir.x).toBe(0);
    expect(dir.z).toBe(0);
  });

  it('edgeRiskFraction is 0 far from the boundary and climbs to 1 at/beyond it', () => {
    expect(edgeRiskFraction({ x: 0, z: 0 }, 3)).toBe(0);
    expect(edgeRiskFraction({ x: 0, z: RINGOUT_RADIUS_M }, 3)).toBeCloseTo(1, 5);
    expect(edgeRiskFraction({ x: 0, z: RINGOUT_RADIUS_M + 5 }, 3)).toBe(1);
    const partial = edgeRiskFraction({ x: 0, z: RINGOUT_RADIUS_M - 1.5 }, 3);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });
});

describe('perceiveCombatant', () => {
  it('derives speed from the velocity vector', () => {
    const p = perceiveCombatant(rawState({ velocityXZ: { x: 3, z: 4 } }));
    expect(p.speedMps).toBeCloseTo(5, 5);
  });

  it('flags an imminent hitbox only for engaged attack states', () => {
    expect(perceiveCombatant(rawState({ attackState: AttackState.Neutral })).hasImminentHitbox).toBe(false);
    expect(perceiveCombatant(rawState({ attackState: AttackState.DashRecovery })).hasImminentHitbox).toBe(false);
    expect(perceiveCombatant(rawState({ attackState: AttackState.CircularActive })).hasImminentHitbox).toBe(true);
    expect(perceiveCombatant(rawState({ attackState: AttackState.DashActive })).hasImminentHitbox).toBe(true);
  });

  it('predictPositionXZ extrapolates linearly from current velocity', () => {
    const p = perceiveCombatant(rawState({ positionXZ: { x: 1, z: 1 }, velocityXZ: { x: 2, z: 0 } }));
    const predicted = predictPositionXZ(p, 0.5);
    expect(predicted.x).toBeCloseTo(2, 5);
    expect(predicted.z).toBeCloseTo(1, 5);
  });
});

describe('evaluateRisk', () => {
  it('reports high edgeRisk near the boundary, scaled by personality edgeCautionMultiplier', () => {
    const own = perceiveCombatant(rawState({ positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 0.5 } }));
    const opponent = perceiveCombatant(rawState({ positionXZ: { x: 0, z: 0 } }));
    const world = buildWorldState(0, own, opponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
    const risk = evaluateRisk(world, DEFAULT_AI_PERSONALITY);
    expect(risk.edgeRisk).toBeGreaterThan(0.8);
  });

  it('reports zero opponentThreat when the opponent has no imminent hitbox, regardless of distance', () => {
    const own = perceiveCombatant(rawState({ positionXZ: { x: 0, z: 0 } }));
    const opponent = perceiveCombatant(rawState({ positionXZ: { x: 1, z: 0 }, attackState: AttackState.Neutral }));
    const world = buildWorldState(0, own, opponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
    expect(evaluateRisk(world, DEFAULT_AI_PERSONALITY).opponentThreat).toBe(0);
  });

  it('reports meaningful opponentThreat when a nearby opponent has an active hitbox', () => {
    const own = perceiveCombatant(rawState({ positionXZ: { x: 0, z: 0 } }));
    const opponent = perceiveCombatant(rawState({ positionXZ: { x: 1, z: 0 }, attackState: AttackState.DashActive }));
    const world = buildWorldState(0, own, opponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
    expect(evaluateRisk(world, DEFAULT_AI_PERSONALITY).opponentThreat).toBeGreaterThan(0.5);
  });

  it('reports higher opportunity against a Broken opponent', () => {
    const own = perceiveCombatant(rawState());
    const healthyOpponent = perceiveCombatant(rawState({ positionXZ: { x: 3, z: 0 } }));
    const brokenOpponent = perceiveCombatant(rawState({ positionXZ: { x: 3, z: 0 }, isBroken: true, stabilityFraction: 0 }));
    const worldHealthy = buildWorldState(0, own, healthyOpponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
    const worldBroken = buildWorldState(0, own, brokenOpponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
    expect(evaluateRisk(worldBroken, DEFAULT_AI_PERSONALITY).opportunity).toBeGreaterThan(
      evaluateRisk(worldHealthy, DEFAULT_AI_PERSONALITY).opportunity,
    );
  });

  it('reports higher selfVulnerability when Broken/low Stability', () => {
    const healthyOwn = perceiveCombatant(rawState());
    const brokenOwn = perceiveCombatant(rawState({ isBroken: true, stabilityFraction: 0 }));
    const opponent = perceiveCombatant(rawState({ positionXZ: { x: 3, z: 0 } }));
    const worldHealthy = buildWorldState(0, healthyOwn, opponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
    const worldBroken = buildWorldState(0, brokenOwn, opponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
    expect(evaluateRisk(worldBroken, DEFAULT_AI_PERSONALITY).selfVulnerability).toBeGreaterThan(
      evaluateRisk(worldHealthy, DEFAULT_AI_PERSONALITY).selfVulnerability,
    );
  });
});
