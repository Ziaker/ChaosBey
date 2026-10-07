// ============================================================
// EDGE RECOVERY AROUND A BLOCKING OPPONENT — UNIT TESTS (M7 PART 2b)
// ActionSelection.edgeRecoveryDirection(): edge recovery heads for the
// center, unless the opponent stands in that path (within
// RECOVERY_BLOCKED_MAX_DISTANCE_M = 3 m and within cos 0.8 of the straight
// line to the center) — then it goes around, sideways away from the
// opponent's offset with part of the inward direction. Checked here in
// every orientation around the arena, on both offset sides, at the
// configured thresholds, and for finite output.
// ============================================================

import { describe, expect, it } from 'vitest';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { edgeRecoveryDirection } from '../../src/ai/decision/ActionSelection';
import { buildWorldState, type WorldState } from '../../src/ai/decision/WorldState';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { add, dot, length, perpendicular, scale, type Vec2 } from '../../src/physics/Vec2';

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
    dashReadiness: 1,
    momentum: 0,
    airRecoveryAvailable: false,
    canAffordDodge: true,
    ...overrides,
  };
}

function world(own: Vec2, opponent: Vec2): WorldState {
  return buildWorldState(0, perceiveCombatant(rawState({ positionXZ: own })), perceiveCombatant(rawState({ positionXZ: opponent })), {
    state: ClashState.Idle,
    cooldownRemainingS: 0,
  });
}

/** AI 1.9 m inside the ring-out radius (edge danger) at `angleRad` around the arena; `alongM` toward the center and `sideM` sideways (perpendicular(center)) place the opponent. */
function scenario(angleRad: number, alongM: number, sideM: number) {
  const ownRadiusM = RINGOUT_RADIUS_M - 1.9;
  const own = { x: ownRadiusM * Math.sin(angleRad), z: ownRadiusM * Math.cos(angleRad) };
  const center = { x: -Math.sin(angleRad), z: -Math.cos(angleRad) };
  const side = perpendicular(center);
  const opponent = add(own, add(scale(center, alongM), scale(side, sideM)));
  return { w: world(own, opponent), center, side, own, opponent };
}

const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (deg * Math.PI) / 180);

function expectUnitAndFinite(direction: Vec2): void {
  expect(Number.isFinite(direction.x) && Number.isFinite(direction.z)).toBe(true);
  expect(length(direction)).toBeCloseTo(1, 9);
}

describe('edgeRecoveryDirection — opponent blocking the way to the center (M7 Part 2b)', () => {
  for (const angle of ANGLES) {
    const label = `${Math.round((angle * 180) / Math.PI)}°`;

    it(`${label}: blocked -> goes around (not through the opponent), still inward, finite`, () => {
      const { w, center } = scenario(angle, 2, 0.3);
      const direction = edgeRecoveryDirection(w);
      expectUnitAndFinite(direction);
      const toOpponent = w.directionToOpponent;
      // Not the straight line through the opponent...
      expect(dot(direction, toOpponent)).toBeLessThan(0.8);
      expect(dot(direction, center)).toBeLessThan(0.99);
      // ...but still a recovery: clearly inward, never outward.
      expect(dot(direction, center)).toBeGreaterThan(0.3);
    });

    it(`${label}: detours to the side away from the opponent's offset, mirror-symmetric`, () => {
      const right = scenario(angle, 2, 0.3);
      const left = scenario(angle, 2, -0.3);
      const dRight = edgeRecoveryDirection(right.w);
      const dLeft = edgeRecoveryDirection(left.w);
      expect(dot(dRight, right.side)).toBeLessThan(0); // opponent offset to +side -> go -side
      expect(dot(dLeft, left.side)).toBeGreaterThan(0);
      expect(dot(dRight, right.center)).toBeCloseTo(dot(dLeft, left.center), 9);
      expect(dot(dRight, right.side)).toBeCloseTo(-dot(dLeft, left.side), 9);
    });

    it(`${label}: clear way (opponent far, or off the line) -> straight to the center`, () => {
      for (const [along, sideways] of [
        [4, 0], // farther than 3 m
        [1.5, 1.5], // off the line (cos 0.71 < 0.8)
        [-2, 0], // behind (outward)
      ] as const) {
        const { w, center } = scenario(angle, along, sideways);
        const direction = edgeRecoveryDirection(w);
        expect(direction.x).toBeCloseTo(center.x, 9);
        expect(direction.z).toBeCloseTo(center.z, 9);
      }
    });
  }

  it('respects the configured thresholds exactly: 3 m and cos 0.8 inclusive-blocked, just past them clear', () => {
    const angle = 0.3;
    const blockedAtDistance = edgeRecoveryDirection(scenario(angle, 2.999, 0).w);
    const clearPastDistance = edgeRecoveryDirection(scenario(angle, 3.001, 0).w);
    const { center } = scenario(angle, 0, 0);
    expect(dot(blockedAtDistance, center)).toBeLessThan(0.99);
    expect(dot(clearPastDistance, center)).toBeCloseTo(1, 9);
    // Just inside / outside cos 0.8 at 2 m: sideways = along x tan(acos 0.8) = along x 0.75.
    const inside = edgeRecoveryDirection(scenario(angle, 2 * 0.8, 2 * 0.6 * 0.99).w);
    const outside = edgeRecoveryDirection(scenario(angle, 2 * 0.8, 2 * 0.6 * 1.01).w);
    expect(dot(inside, center)).toBeLessThan(0.99);
    expect(dot(outside, center)).toBeCloseTo(1, 9);
  });

  it('degenerate inputs stay finite: opponent on top of the AI, AI at the exact center', () => {
    const own = { x: 0, z: RINGOUT_RADIUS_M - 1.9 };
    const onTop = edgeRecoveryDirection(world(own, own));
    expect(Number.isFinite(onTop.x) && Number.isFinite(onTop.z)).toBe(true);
    const atCenter = edgeRecoveryDirection(world({ x: 0, z: 0 }, { x: 0, z: 1 }));
    expect(Number.isFinite(atCenter.x) && Number.isFinite(atCenter.z)).toBe(true);
  });
});
