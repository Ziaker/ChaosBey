// Owner, 2026-10-02 (Lote 2): the Dash is paced by a cooldown, not by Attack
// Energy. No resource limits how many Dashes a Bey makes; the cooldown starts
// when a Dash ends and must run out before the next one can charge.

import { describe, expect, it } from 'vitest';
import { AttackController, AttackState } from '../../src/combat/attacks/AttackController';
import { DASH_ACTIVE_DURATION_S, DASH_COOLDOWN_DEFAULT_S, DASH_COOLDOWN_RANGE, DASH_MAX_CHARGE_S, TAP_MAX_HOLD_S } from '../../src/combat/attacks/AttackTuning';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';

const DT = 1 / 60;
const ORIGIN = { x: 0, z: 0 };
const FAR = { x: 0, z: 30 };

function input(held: boolean, pressed: boolean): ControllerActions {
  return { held: held ? new Set([Action.Attack]) : new Set(), pressedThisFrame: pressed ? new Set([Action.Attack]) : new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
}

/** Holds Attack for `holdS`, releases, and runs until the attack is Neutral again. Returns the states seen. */
function dash(attack: AttackController, holdS: number): AttackState[] {
  const seen: AttackState[] = [];
  seen.push(attack.tick(input(true, true), 0, ORIGIN, FAR, DT).state);
  for (let i = 0; i < Math.round(holdS / DT); i++) seen.push(attack.tick(input(true, false), 0, ORIGIN, FAR, DT).state);
  for (let i = 0; i < 120 && attack.getState() !== AttackState.Neutral; i++) seen.push(attack.tick(input(false, false), 0, ORIGIN, FAR, DT).state);
  return seen;
}

function idle(attack: AttackController, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) attack.tick(input(false, false), 0, ORIGIN, FAR, DT);
}

describe('Dash cooldown (owner, 2026-10-02)', () => {
  it('is a MatchConfig value: provisional default 1.5 s, slider 0.5-5 s step 0.25', () => {
    expect(createDefaultMatchConfig().dashCooldownS).toBe(1.5);
    expect(DASH_COOLDOWN_DEFAULT_S).toBe(1.5);
    expect(DASH_COOLDOWN_RANGE).toEqual({ min: 0.5, max: 5, step: 0.25 });
  });

  it('no resource limit: ten full-charge Dashes in a row all fire, each after the cooldown', () => {
    const attack = new AttackController(undefined, 1.5);
    for (let n = 0; n < 10; n++) {
      expect(dash(attack, DASH_MAX_CHARGE_S + 1)).toContain(AttackState.DashActive);
      idle(attack, 1.5);
    }
  });

  it('a hold during the cooldown waits, then charges once the Dash is ready', () => {
    const attack = new AttackController(undefined, 1.5);
    dash(attack, 0.5); // whiffs: DashActive 0.5 s, then recovery; the cooldown starts when the Dash ends
    expect(attack.getDashCooldownRemainingS()).toBeGreaterThan(0);
    const remaining = attack.getDashCooldownRemainingS();
    attack.tick(input(true, true), 0, ORIGIN, FAR, DT);
    let firstChargeTick = -1;
    for (let i = 1; i < 400 && firstChargeTick < 0; i++) {
      if (attack.tick(input(true, false), 0, ORIGIN, FAR, DT).state === AttackState.ChargingDash) firstChargeTick = i;
    }
    // Charging starts on the tick the cooldown runs out (not before), and from a fresh charge.
    expect(firstChargeTick).toBeGreaterThanOrEqual(Math.floor(remaining / DT) - 1);
    expect(firstChargeTick).toBeLessThanOrEqual(Math.ceil(remaining / DT) + 1);
    expect(attack.getChargeFraction()).toBe(0);
  });

  it('a hold released during the cooldown is neither a Dash nor a Circular', () => {
    const attack = new AttackController(undefined, 3);
    dash(attack, 0.3);
    const seen = dash(attack, TAP_MAX_HOLD_S + 0.3);
    expect(seen).not.toContain(AttackState.DashActive);
    expect(seen).not.toContain(AttackState.CircularActive);
  });

  it('a tap during the cooldown is still a Circular (the cooldown is the Dash\'s only)', () => {
    const attack = new AttackController(undefined, 3);
    dash(attack, 0.3);
    attack.tick(input(true, true), 0, ORIGIN, FAR, DT);
    expect(attack.tick(input(false, false), 0, ORIGIN, FAR, DT).state).toBe(AttackState.CircularActive);
  });

  it('starts when the Dash ends, on a hit as on a whiff, and the HUD readiness empties then refills', () => {
    const attack = new AttackController(undefined, 2);
    attack.tick(input(true, true), 0, ORIGIN, FAR, DT);
    for (let i = 0; i < 30; i++) attack.tick(input(true, false), 0, ORIGIN, FAR, DT);
    expect(attack.getDashReadiness()).toBe(1); // charging: ready (the DASH line shows the charge)
    attack.tick(input(false, false), 0, ORIGIN, FAR, DT);
    expect(attack.getState()).toBe(AttackState.DashActive);
    expect(attack.getDashReadiness()).toBe(0);
    attack.registerHitConfirmed();
    expect(attack.getDashCooldownRemainingS()).toBe(2);
    idle(attack, 1);
    expect(attack.getDashReadiness()).toBeCloseTo(0.5, 1);
    idle(attack, 1.1);
    expect(attack.getDashReadiness()).toBe(1);

    const whiff = new AttackController(undefined, 2);
    dash(whiff, 0.3);
    // After a whiff the cooldown started when DashActive ended, and has been running through the recovery.
    expect(whiff.getDashCooldownRemainingS()).toBeGreaterThan(0);
    expect(whiff.getDashCooldownRemainingS()).toBeLessThan(2);
    expect(DASH_ACTIVE_DURATION_S).toBeGreaterThan(0);
  });

  it('is part of the deterministic state', () => {
    const attack = new AttackController(undefined, 1.5);
    dash(attack, 0.3);
    expect(attack.getDeterministicState()).toMatchObject({ dashCooldownRemainingS: expect.any(Number), waitingForDash: false });
  });
});
