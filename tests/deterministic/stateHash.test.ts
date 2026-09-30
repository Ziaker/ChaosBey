// ============================================================
// STATE HASH V1 SELF-TESTS (M9-A)
// Unit tests against hand-built CanonicalMatchStateV1 fixtures (pure
// function, no physics harness needed) for the properties StateHash.ts's
// own header promises: deterministic, sensitive to any real field, immune
// to -0/+0 and NaN-payload noise, never dependent on object key order, and
// broken down per-section. A physics-driven integration check (same seed
// -> identical hash sequence, different seed -> diverges) lives in
// canonicalMatchState.test.ts's equivalent coverage of the state itself;
// hashing an already-proven-deterministic state adds nothing physics-y to
// re-test here.
// ============================================================

import { describe, expect, it } from 'vitest';
import { computeStateHash } from '../../src/replay/StateHash';
import type { CanonicalBeyState, CanonicalMatchStateV1 } from '../../src/replay/CanonicalMatchState';
import { CANONICAL_STATE_VERSION } from '../../src/replay/contracts';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';

function makeBeyState(overrides: Partial<CanonicalBeyState> = {}): CanonicalBeyState {
  return {
    positionM: { x: 1, y: 0.5, z: -2 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    linvelMps: { x: 0.1, y: 0, z: 0.2 },
    angvelRadPerS: { x: 0, y: 3, z: 0 },
    movement: { headingRad: 0.7, turnRateRadPerS: 0.1, postImpactCooldownRemainingS: 0 },
    spin: { spinRateRadPerSec: 12, visualSpinAngleRad: 4.2, wobbleEnergy: 0.05, wobbleTimeAccumulatorS: 1.3 },
    drift: { state: DriftState.Idle, hopTimerS: 0, recoveryTimerS: 0, jumpAssistElapsedS: 0, wasGrounded: true, lastAirborneVerticalVelocityMps: 0 },
    dodge: { state: DodgeState.Idle, activeTimerS: 0, cooldownTimerS: 0, wasGrounded: true, airRecoveryAvailable: false, launchPending: false, launchPendingRemainingS: 0 },
    attack: { state: AttackState.Neutral, bufferTimerS: 0, chargeTimerS: 0, activeTimerS: 0, recoveryTimerS: 0 },
    stamina: { value: 100 },
    stability: { value: 100, broken: false, timeSinceLastDamageS: Number.POSITIVE_INFINITY },
    attackEnergy: { value: 50, timeSinceLastConsumptionS: Number.POSITIVE_INFINITY },
    aiRngState: 123456789,
    ...overrides,
  };
}

function makeState(overrides: { first?: Partial<CanonicalBeyState>; second?: Partial<CanonicalBeyState>; tick?: number } = {}): CanonicalMatchStateV1 {
  return {
    canonicalStateVersion: CANONICAL_STATE_VERSION,
    tick: overrides.tick ?? 42,
    first: makeBeyState(overrides.first),
    second: makeBeyState(overrides.second),
    roundOutcome: RoundOutcome.Ongoing,
    clash: {
      state: ClashState.Idle,
      elapsedS: 0,
      cooldownRemainingS: 0,
      firstMashEventCount: 0,
      secondMashEventCount: 0,
      firstStaminaFractionAtStart: 1,
      secondStaminaFractionAtStart: 1,
      firstSpeedMpsAtStart: 0,
      secondSpeedMpsAtStart: 0,
      lastResult: null,
    },
  };
}

describe('computeStateHash', () => {
  it('is deterministic: the same state hashes the same every time', () => {
    const state = makeState();
    expect(computeStateHash(state)).toEqual(computeStateHash(makeState()));
  });

  it('echoes canonicalStateVersion and tick from the state', () => {
    const result = computeStateHash(makeState({ tick: 777 }));
    expect(result.canonicalStateVersion).toBe(CANONICAL_STATE_VERSION);
    expect(result.tick).toBe(777);
  });

  it('reports one hash per section (first/second/match) plus an overall hash', () => {
    const result = computeStateHash(makeState());
    expect(result.sections).toBeDefined();
    expect(Object.keys(result.sections!).sort()).toEqual(['first', 'match', 'second']);
    expect(result.hash).not.toBe(result.sections!.first);
    expect(result.hash).not.toBe(result.sections!.second);
    expect(result.hash).not.toBe(result.sections!.match);
  });

  it('a change on one side only changes that side\'s section hash and the overall hash, never the other side\'s', () => {
    const base = computeStateHash(makeState());
    const changed = computeStateHash(makeState({ first: { aiRngState: 999 } }));
    expect(changed.sections!.first).not.toBe(base.sections!.first);
    expect(changed.sections!.second).toBe(base.sections!.second);
    expect(changed.hash).not.toBe(base.hash);
  });

  it('a change to match-level state (round outcome) changes only the match section', () => {
    const base = computeStateHash(makeState());
    const changedState = makeState();
    (changedState as { roundOutcome: RoundOutcome }).roundOutcome = RoundOutcome.FirstWinsByKo;
    const changed = computeStateHash(changedState);
    expect(changed.sections!.match).not.toBe(base.sections!.match);
    expect(changed.sections!.first).toBe(base.sections!.first);
    expect(changed.sections!.second).toBe(base.sections!.second);
  });

  it('every field in the fixture is actually load-bearing: touching any one of them changes the hash', () => {
    const base = computeStateHash(makeState());
    const mutations: Array<() => CanonicalMatchStateV1> = [
      () => makeState({ first: { positionM: { x: 1.0001, y: 0.5, z: -2 } } }),
      () => makeState({ first: { rotation: { x: 0.001, y: 0, z: 0, w: 1 } } }),
      () => makeState({ first: { linvelMps: { x: 999, y: 0, z: 0.2 } } }),
      () => makeState({ first: { angvelRadPerS: { x: 0, y: 3.5, z: 0 } } }),
      () => makeState({ first: { movement: { headingRad: 1.9, turnRateRadPerS: 0.1, postImpactCooldownRemainingS: 0 } } }),
      () => makeState({ first: { spin: { spinRateRadPerSec: 99, visualSpinAngleRad: 4.2, wobbleEnergy: 0.05, wobbleTimeAccumulatorS: 1.3 } } }),
      () => makeState({ first: { spin: { spinRateRadPerSec: 12, visualSpinAngleRad: 4.2, wobbleEnergy: 0.05, wobbleTimeAccumulatorS: 999 } } }),
      () => makeState({ first: { drift: { state: DriftState.Hopping, hopTimerS: 0, recoveryTimerS: 0, jumpAssistElapsedS: 0, wasGrounded: true, lastAirborneVerticalVelocityMps: 0 } } }),
      () => makeState({ first: { drift: { state: DriftState.Idle, hopTimerS: 0, recoveryTimerS: 0, jumpAssistElapsedS: 0, wasGrounded: false, lastAirborneVerticalVelocityMps: 0 } } }),
      () => makeState({ first: { dodge: { state: DodgeState.Idle, activeTimerS: 0, cooldownTimerS: 0, wasGrounded: true, airRecoveryAvailable: false, launchPending: false, launchPendingRemainingS: 0.5 } } }),
      () => makeState({ first: { attack: { state: AttackState.Buffering, bufferTimerS: 0, chargeTimerS: 0, activeTimerS: 0, recoveryTimerS: 0 } } }),
      () => makeState({ first: { stamina: { value: 42 } } }),
      () => makeState({ first: { stability: { value: 100, broken: true, timeSinceLastDamageS: Number.POSITIVE_INFINITY } } }),
      () => makeState({ first: { attackEnergy: { value: 0, timeSinceLastConsumptionS: 0 } } }),
      () => makeState({ first: { aiRngState: 1 } }),
      () => makeState({ tick: 1 }),
    ];
    for (const [i, mutate] of mutations.entries()) {
      const mutated = computeStateHash(mutate());
      expect(mutated.hash, `mutation ${i} did not change the hash`).not.toBe(base.hash);
    }
  });

  it('canonicalizes -0 to +0: a state differing only by the sign of a zero hashes identically', () => {
    const withNegativeZero = makeState({ first: { linvelMps: { x: -0, y: 0, z: 0.2 } } });
    const withPositiveZero = makeState({ first: { linvelMps: { x: 0, y: 0, z: 0.2 } } });
    expect(computeStateHash(withNegativeZero)).toEqual(computeStateHash(withPositiveZero));
  });

  it('canonicalizes NaN: two independently-produced NaN values in the same field hash identically', () => {
    const nanA = 0 / 0;
    const nanB = Number.parseFloat('not a number');
    expect(Number.isNaN(nanA)).toBe(true);
    expect(Number.isNaN(nanB)).toBe(true);
    const stateA = makeState({ first: { movement: { headingRad: nanA, turnRateRadPerS: 0.1, postImpactCooldownRemainingS: 0 } } });
    const stateB = makeState({ first: { movement: { headingRad: nanB, turnRateRadPerS: 0.1, postImpactCooldownRemainingS: 0 } } });
    expect(computeStateHash(stateA)).toEqual(computeStateHash(stateB));
  });

  it('a NaN state does not hash the same as a non-NaN state (canonicalization never masks a real divergence)', () => {
    const withNaN = computeStateHash(makeState({ first: { movement: { headingRad: NaN, turnRateRadPerS: 0.1, postImpactCooldownRemainingS: 0 } } }));
    const withoutNaN = computeStateHash(makeState());
    expect(withNaN.hash).not.toBe(withoutNaN.hash);
  });

  it('is not dependent on an object\'s own property insertion order (never JSON.stringify(state))', () => {
    const state = makeState();
    // Same logical value, keys inserted in reverse order — a JSON.stringify-
    // based hash could plausibly differ here if it iterated Object.keys()
    // rather than the field-by-field writers this file actually uses.
    const reorderedRotation = { w: state.first.rotation.w, z: state.first.rotation.z, y: state.first.rotation.y, x: state.first.rotation.x };
    const reordered = makeState({ first: { rotation: reorderedRotation } });
    expect(computeStateHash(reordered)).toEqual(computeStateHash(state));
  });

  it("hashes a null and a present Clash lastResult differently, and the present case's own fields are load-bearing", () => {
    const withNull = makeState();
    const withResult = makeState();
    (withResult.clash as { lastResult: unknown }).lastResult = { outcome: 'FirstWins', firstClashPower: 1, secondClashPower: 0.5, firstMashEventCount: 3, secondMashEventCount: 2 };
    const a = computeStateHash(withNull);
    const b = computeStateHash(withResult);
    expect(a.hash).not.toBe(b.hash);

    const withDifferentResult = makeState();
    (withDifferentResult.clash as { lastResult: unknown }).lastResult = { outcome: 'SecondWins', firstClashPower: 1, secondClashPower: 0.5, firstMashEventCount: 3, secondMashEventCount: 2 };
    expect(computeStateHash(withDifferentResult).hash).not.toBe(b.hash);
  });
});
