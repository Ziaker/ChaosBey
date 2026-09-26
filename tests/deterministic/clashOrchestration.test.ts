// ============================================================
// CLASH ORCHESTRATION — buildMashActionSet SELF-TESTS
// The real-input side of the integration: mapping ControllerActions onto
// the opaque string identifiers ClashMash.ts's nextMashEventCount() reads.
// Full end-to-end Clash integration (real tickMatch()) lives in
// clashIntegration.test.ts — this file isolates just this pure mapping.
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildMashActionSet, ClashOrchestration, type HitSnapshotInput } from '../../src/app/simulation/ClashOrchestration';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { AttackState, type ActiveHitbox } from '../../src/combat/attacks/AttackController';
import type { HitEvent } from '../../src/combat/hit-detection/HitDetection';
import { ClashOutcome, ClashState, type ClashResult } from '../../src/combat/clash/ClashController';
import { CLASH_WINDOW_S } from '../../src/combat/clash/ClashTuning';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { createBey } from '../../src/bey/core/Bey';
import { DEFAULT_BEY_DEFINITION } from '../../src/bey/archetype/BeyDefinition';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';

function actionsWith(pressedThisFrame: Action[]): ControllerActions {
  return {
    held: new Set(pressedThisFrame),
    pressedThisFrame: new Set(pressedThisFrame),
    attackHoldDurationSeconds: 0,
    jumpDriftHoldDurationSeconds: 0,
  };
}

describe('buildMashActionSet', () => {
  it('maps Attack/JumpDrift/Dodge (Z/X/C) through unchanged', () => {
    const set = buildMashActionSet(actionsWith([Action.Attack, Action.JumpDrift, Action.Dodge]));
    expect(set.size).toBe(3);
    expect(set.has(Action.Attack)).toBe(true);
    expect(set.has(Action.JumpDrift)).toBe(true);
    expect(set.has(Action.Dodge)).toBe(true);
  });

  it('filters out every non-mash action (movement/steering/pause/debug)', () => {
    const set = buildMashActionSet(actionsWith([Action.MoveForward, Action.SteerLeft, Action.Pause, Action.DebugToggle]));
    expect(set.size).toBe(0);
  });

  it('mixes correctly — only the Z/X/C subset survives alongside unrelated actions pressed the same frame', () => {
    const set = buildMashActionSet(actionsWith([Action.MoveForward, Action.Attack, Action.SteerRight]));
    expect(Array.from(set)).toEqual([Action.Attack]);
  });

  it('an empty pressedThisFrame maps to an empty set', () => {
    expect(buildMashActionSet(actionsWith([])).size).toBe(0);
  });
});

// ============================================================
// processTickHits — real 150ms compatible-attack window
// Precise, synthetic-hit unit tests for the cross-tick window mechanism
// (delta measured directly, no physics/attack-state-machine timing
// uncertainty) — clashIntegration.test.ts exercises the same mechanism
// through real tickMatch()/real attacks for a looser, realistic check.
// ============================================================

const FIXED_DELTA_SECONDS = 1 / 60;
const HITBOX: ActiveHitbox = { kind: 'circular', radiusM: 1, knockbackForce: 20, stabilityDamage: 8 };

function makeHit(attackerIsFirst: boolean, defenderAttackState: AttackState): HitSnapshotInput {
  const hit: HitEvent = { attackerIsFirst, hitbox: HITBOX, caughtOpponentDashing: false };
  return {
    hit,
    attackerPositionXZ: { x: 0, z: attackerIsFirst ? -1 : 1 },
    defenderPositionXZ: { x: 0, z: attackerIsFirst ? 1 : -1 },
    attackerVelocityXZ: { x: 0, z: 0 },
    attackerSpeedMps: 5,
    attackerStaminaFraction: 1,
    defenderSpeedMps: 5,
    defenderStabilityFraction: 1,
    defenderStaminaPenaltyFraction: 0,
    defenderAttackState,
  };
}

function advance(clash: ClashOrchestration, ticks: number): void {
  for (let i = 0; i < ticks; i++) clash.processTickHits(FIXED_DELTA_SECONDS, []);
}

describe('processTickHits — compatible-attack window', () => {
  it('two compatible hits in the very same tick start a Clash (delta = 0)', () => {
    const clash = new ClashOrchestration(resolveMatchConfig());
    const result = clash.processTickHits(FIXED_DELTA_SECONDS, [makeHit(true, AttackState.CircularActive), makeHit(false, AttackState.CircularActive)]);
    expect(clash.controller.getState()).toBe(ClashState.Active);
    expect(result.toResolveNormally).toHaveLength(0);
  });

  it('a compatible hit a few ticks later — defender was engaged (ChargingDash) when the first one connected — still starts a Clash, within the window', () => {
    const clash = new ClashOrchestration(resolveMatchConfig());
    const first = clash.processTickHits(FIXED_DELTA_SECONDS, [makeHit(true, AttackState.ChargingDash)]);
    expect(first.toResolveNormally).toHaveLength(0); // held, not resolved yet.
    expect(clash.controller.getState()).toBe(ClashState.Idle); // no pair yet either.
    advance(clash, 4); // a handful of ticks pass — well under the window.
    const later = clash.processTickHits(FIXED_DELTA_SECONDS, [makeHit(false, AttackState.Neutral)]); // 5 ticks after the first, total.
    expect(clash.controller.getState()).toBe(ClashState.Active);
    expect(later.toResolveNormally).toHaveLength(0);
  });

  it('a compatible hit exactly at the 150ms boundary still starts a Clash (isWithinClashWindow is inclusive)', () => {
    const clash = new ClashOrchestration(resolveMatchConfig());
    clash.processTickHits(FIXED_DELTA_SECONDS, [makeHit(true, AttackState.ChargingDash)]);
    advance(clash, 8);
    const later = clash.processTickHits(FIXED_DELTA_SECONDS, [makeHit(false, AttackState.Neutral)]); // 9 ticks after the first = exactly CLASH_WINDOW_S (0.15s).
    expect(9 * FIXED_DELTA_SECONDS).toBe(CLASH_WINDOW_S); // sanity: this really is the exact boundary, not an approximation.
    expect(clash.controller.getState()).toBe(ClashState.Active);
    expect(later.toResolveNormally).toHaveLength(0);
  });

  it('a hit beyond the 150ms window does not start a Clash — both resolve independently, normally', () => {
    const clash = new ClashOrchestration(resolveMatchConfig());
    const first = clash.processTickHits(FIXED_DELTA_SECONDS, [makeHit(true, AttackState.ChargingDash)]);
    expect(first.toResolveNormally).toHaveLength(0);
    advance(clash, 9);
    const later = clash.processTickHits(FIXED_DELTA_SECONDS, [makeHit(false, AttackState.Neutral)]); // 10 ticks after the first — past the window.
    expect(clash.controller.getState()).toBe(ClashState.Idle); // never started.
    expect(later.toResolveNormally).toHaveLength(2); // the stale first hit (flushed normally) plus the fresh second hit (resolved immediately).
    expect(later.toResolveNormally.every((r) => r.forceMultiplier === 1)).toBe(true);
  });

  it('a solo hit — defender not engaged in any attack at all — resolves immediately, at zero added latency', () => {
    const clash = new ClashOrchestration(resolveMatchConfig());
    const result = clash.processTickHits(FIXED_DELTA_SECONDS, [makeHit(true, AttackState.Neutral)]);
    expect(result.toResolveNormally).toHaveLength(1);
    expect(clash.controller.getState()).toBe(ClashState.Idle);
  });

  it('a defender merely in attack Recovery (hitbox already gone) does not count as "engaged" — the hit still resolves immediately', () => {
    const clash = new ClashOrchestration(resolveMatchConfig());
    const result = clash.processTickHits(FIXED_DELTA_SECONDS, [makeHit(true, AttackState.CircularRecovery)]);
    expect(result.toResolveNormally).toHaveLength(1);
  });
});

describe('applyResolution — Attack/Defense archetype stats (Milestone 6, GDD section 6/31)', () => {
  it('a Clash outcome/loser never depends on Attack — only the post-resolution knockback/Stability damage does', async () => {
    async function resolveWithWinnerAttack(attackRating: number) {
      const physics = await PhysicsWorld.create();
      const clash = new ClashOrchestration(resolveMatchConfig());
      const winnerDefinition = { ...DEFAULT_BEY_DEFINITION, ratings: { ...DEFAULT_BEY_DEFINITION.ratings, attack: attackRating } };
      const first = createBey(physics, { x: 0, y: 1, z: -1 }, winnerDefinition);
      const second = createBey(physics, { x: 0, y: 1, z: 1 }, DEFAULT_BEY_DEFINITION);

      // Synthetic result — ClashController's own ClashPower/mash formula
      // (which actually decides FirstWins/SecondWins/Tie) never reads Bey
      // stats at all; this fixes the outcome so the test isolates what
      // applyResolution() does with it.
      const result: ClashResult = {
        outcome: ClashOutcome.FirstWins,
        firstClashPower: 10,
        secondClashPower: 5,
        firstMashEventCount: 3,
        secondMashEventCount: 1,
      };
      const pair = { firstAttackerHit: makeHit(true, AttackState.Neutral), secondAttackerHit: makeHit(false, AttackState.Neutral) };
      return clash.applyResolution({ result, pair }, physics, first, second);
    }

    const lowAttack = await resolveWithWinnerAttack(1);
    const highAttack = await resolveWithWinnerAttack(10);

    // The outcome/loser are identical regardless of Attack — Attack only scales the physical consequence.
    expect(lowAttack.outcome).toBe(ClashOutcome.FirstWins);
    expect(highAttack.outcome).toBe(ClashOutcome.FirstWins);
    expect(lowAttack.loserIsFirst).toBe(false);
    expect(highAttack.loserIsFirst).toBe(false);

    expect(highAttack.knockbackForce).toBeGreaterThan(lowAttack.knockbackForce as number);
    expect(highAttack.stabilityDamageAmount).toBeGreaterThan(lowAttack.stabilityDamageAmount as number);
  });
});
