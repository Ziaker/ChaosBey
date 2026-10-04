// Owner, 2026-10-02 (Lote 5): combat rules, through the real tickMatch().
// 12 — Stamina 0 = spin-out loss (simultaneous = Draw).
// 13 — the Circular is defensive: its user takes nothing from hits or body
//      contact while it is active, and whoever touches it is launched.
// 14 — the movement Stamina drain is 30% lower, and scales with a slider.
// 8b — the dodge goes 40% farther (same duration and i-frames).

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { STAMINA_EXTRA_DRAIN_PER_S_AT_FULL_SPEED } from '../../src/bey/stamina/StaminaTuning';
import { StaminaSystem } from '../../src/bey/stamina/StaminaSystem';
import { INTENDED_MAX_SPEED_MPS } from '../../src/bey/movement/MovementTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { RoundOutcome, RoundState } from '../../src/combat/round-rules/RoundState';
import { DODGE_ACTIVE_DURATION_S, DODGE_BURST_SPEED_MPS } from '../../src/dodge/DodgeTuning';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const act = (held: Action[], pressed: Action[] = []): ControllerActions => ({ ...NONE, held: new Set(held), pressedThisFrame: new Set(pressed) });

async function harness(firstZ = -1.6, secondZ = 1.6, overrides = {}): Promise<CombatHarness> {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: firstZ }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: secondZ }, { arenaFloor: 'flat', ...overrides });
  for (let i = 0; i < 30; i++) h.tick(NONE, NONE);
  return h;
}

describe('12 — Stamina 0 = spin-out (owner, 2026-10-02)', () => {
  it('the tick Stamina reaches 0 the round ends, won by the other Bey', async () => {
    const h = await harness(-8, 8);
    h.second.stamina.resource.set(0.001);
    let ended = -1;
    for (let i = 0; i < 10 && ended < 0; i++) {
      const r = h.tick(NONE, NONE);
      if (h.roundState.isOver) ended = i;
      if (ended >= 0) expect(r.combatEvents.some((e) => e.kind === 'spinOut' && !e.targetIsFirst)).toBe(true);
    }
    expect(ended).toBe(0);
    expect(h.roundState.result).toBe(RoundOutcome.FirstWinsBySpinOut);
  });

  it('both on the same tick: a Draw; a KO still names the KO', () => {
    const both = new RoundState();
    both.resolveTick({ firstKoed: false, secondKoed: false, firstRingOut: false, secondRingOut: false, firstSpunOut: true, secondSpunOut: true });
    expect(both.result).toBe(RoundOutcome.Draw);
    const first = new RoundState();
    first.resolveTick({ firstKoed: false, secondKoed: false, firstRingOut: false, secondRingOut: false, firstSpunOut: true });
    expect(first.result).toBe(RoundOutcome.SecondWinsBySpinOut);
    const ko = new RoundState();
    ko.resolveTick({ firstKoed: false, secondKoed: true, firstRingOut: false, secondRingOut: false, secondSpunOut: true });
    expect(ko.result).toBe(RoundOutcome.FirstWinsByKo);
  });
});

describe('13 — the Circular is defensive (owner, 2026-10-02)', () => {
  /** First taps Z (Circular) as second Dashes into it from close range. */
  async function dashIntoCircular(overrides = {}) {
    // The dasher (second) starts facing the Circular user (first) — a Bey spawns facing +Z.
    const h = await harness(2.5, -2.5, overrides);
    const stability0 = h.first.stability.resource.value;
    let firstCircularSeen = false;
    let secondPeakUp = 0;
    let secondPeakSpeed = 0;
    for (let t = 0; t < 60; t++) {
      // Second: hold Z ~0.3 s then release (a Dash toward first, arriving ~tick 36). First: tap Z so its Circular is up.
      const secondA = t < 18 ? act([Action.Attack], t === 0 ? [Action.Attack] : []) : NONE;
      const firstA = t === 24 ? act([Action.Attack], [Action.Attack]) : NONE;
      h.tick(firstA, secondA);
      if (h.first.attack.getState() === AttackState.CircularActive) firstCircularSeen = true;
      const v = h.second.body.linvel();
      secondPeakUp = Math.max(secondPeakUp, v.y);
      secondPeakSpeed = Math.max(secondPeakSpeed, Math.hypot(v.x, v.z));
    }
    return { h, firstCircularSeen, lost: stability0 - h.first.stability.resource.value, secondPeakUp, secondPeakSpeed };
  }

  it('Circular active + the opponent\'s Dash: its user loses no Stability, the dasher is launched upward', async () => {
    const r = await dashIntoCircular();
    expect(r.firstCircularSeen).toBe(true);
    expect(r.lost).toBeLessThanOrEqual(0.001);
    expect(r.secondPeakUp).toBeGreaterThan(4);
  });

  it('body contact with an active Circular launches the other Bey; the user takes nothing', async () => {
    const h = await harness(1.2, -1.2);
    const stability0 = h.first.stability.resource.value;
    let peakUp = 0;
    let launched = false;
    let stabilityWhileActive = stability0;
    for (let t = 0; t < 30; t++) {
      // Drive the second Bey into the first until the Circular throws it.
      if (!launched) h.second.body.setLinvel({ x: 0, y: 0, z: 6 }, true);
      const r = h.tick(t === 0 ? act([Action.Attack], [Action.Attack]) : NONE, NONE);
      if (r.combatEvents.some((e) => e.kind === 'knockback' && !e.targetIsFirst)) launched = true;
      if (r.first.attackState === AttackState.CircularActive || !launched) stabilityWhileActive = h.first.stability.resource.value;
      peakUp = Math.max(peakUp, h.second.body.linvel().y);
    }
    expect(launched).toBe(true);
    expect(stabilityWhileActive).toBeGreaterThanOrEqual(stability0 - 0.001);
    expect(peakUp).toBeGreaterThan(4);
  });

  it('the Circular launch force slider scales the launch, 0 = no launch', async () => {
    const strong = await dashIntoCircular({ circularLaunchForce: 2 });
    const off = await dashIntoCircular({ circularLaunchForce: 0 });
    const normal = await dashIntoCircular();
    expect(strong.secondPeakUp).toBeGreaterThan(normal.secondPeakUp * 1.5);
    expect(off.secondPeakUp).toBeLessThan(normal.secondPeakUp * 0.5);
  });
});

describe('14 — movement Stamina drain 30% lower, with a slider (owner, 2026-10-02)', () => {
  it('3 -> 2.1 per second at full speed; the slider scales only the movement part', () => {
    expect(STAMINA_EXTRA_DRAIN_PER_S_AT_FULL_SPEED).toBeCloseTo(2.1, 9);
    expect(createDefaultMatchConfig().movementStaminaDrain).toBe(0.2); // owner base rules (2026-10-04): 20%
    const drained = (scale: number, speed: number): number => {
      const s = new StaminaSystem(1, scale);
      const before = s.resource.value;
      for (let i = 0; i < 60; i++) s.tick(speed, 1 / 60);
      return before - s.resource.value;
    };
    expect(drained(1, INTENDED_MAX_SPEED_MPS)).toBeCloseTo(0.4 + 2.1, 6);
    expect(drained(2, INTENDED_MAX_SPEED_MPS)).toBeCloseTo(0.4 + 4.2, 6);
    expect(drained(0, INTENDED_MAX_SPEED_MPS)).toBeCloseTo(0.4, 6);
    expect(drained(2, 0)).toBeCloseTo(0.4, 6); // the base spin drain is not scaled
  });
});

describe('8b — the dodge goes 40% farther (owner, 2026-10-02)', () => {
  it('distance over the dodge = 12.6 m/s × its duration (+40% ±5% vs 9 m/s), same i-frame window', async () => {
    expect(DODGE_BURST_SPEED_MPS).toBeCloseTo(9 * 1.4, 9);
    const h = await harness(-8, 8);
    let dodgingTicks = 0;
    let start: { x: number; z: number } | null = null;
    let end: { x: number; z: number } | null = null;
    for (let t = 0; t < 60; t++) {
      const before = h.first.body.translation();
      const r = h.tick(t === 0 ? act([Action.Dodge, Action.MoveForward], [Action.Dodge]) : NONE, NONE);
      if (r.first.dodgeState === 'Dodging') {
        dodgingTicks++;
        start ??= { x: before.x, z: before.z };
        const p = h.first.body.translation();
        end = { x: p.x, z: p.z };
      }
    }
    // Distance covered while Dodging (the burst itself, not the slide after it).
    const distance = Math.hypot(end!.x - start!.x, end!.z - start!.z);
    const expected = DODGE_BURST_SPEED_MPS * DODGE_ACTIVE_DURATION_S;
    expect(distance).toBeGreaterThan(expected * 0.95);
    expect(distance).toBeLessThan(expected * 1.05);
    expect(distance / (9 * DODGE_ACTIVE_DURATION_S)).toBeGreaterThan(1.35);
    expect(Math.abs(dodgingTicks - Math.round(DODGE_ACTIVE_DURATION_S * 60))).toBeLessThanOrEqual(1); // same duration (the edge tick counts either way)
  });
});
