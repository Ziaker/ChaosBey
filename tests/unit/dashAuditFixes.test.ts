// Owner audit, 2026-10-03 — B1/B2 (Lote 2's Dash cooldown):
// B1: Z pressed during DashRecovery and held, with no second press, must still start the next Dash as soon as one is
//     allowed (the press used to be dropped: no new edge once Neutral).
// B2: dashReadiness = 1 must mean a new Dash can really start — at the 0.5 s minimum cooldown the line read full
//     during the 0.6 s whiff recovery, which still blocked the Dash.

import { describe, expect, it } from 'vitest';
import { AttackController, AttackState } from '../../src/combat/attacks/AttackController';
import { DASH_COOLDOWN_RANGE, DASH_WHIFF_RECOVERY_S } from '../../src/combat/attacks/AttackTuning';
import { Action, type ControllerActions } from '../../src/input/actions/Action';

const DT = 1 / 60;
const ORIGIN = { x: 0, z: 0 };
const FAR = { x: 0, z: 30 };
const input = (held: boolean, pressed: boolean): ControllerActions => ({ held: held ? new Set([Action.Attack]) : new Set(), pressedThisFrame: pressed ? new Set([Action.Attack]) : new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 });

/** A full Dash that whiffs: hold, release, then tick until DashRecovery. */
function dashIntoRecovery(attack: AttackController): void {
  attack.tick(input(true, true), 0, ORIGIN, FAR, DT);
  for (let i = 0; i < 40; i++) attack.tick(input(true, false), 0, ORIGIN, FAR, DT);
  for (let i = 0; i < 200 && attack.getState() !== AttackState.DashRecovery; i++) attack.tick(input(false, false), 0, ORIGIN, FAR, DT);
  expect(attack.getState()).toBe(AttackState.DashRecovery);
}

/** Can a Dash start right now? Probes a clone-free way: the state machine allows it only from Neutral with no cooldown. */
const dashCanStart = (a: AttackController): boolean => a.getState() === AttackState.Neutral && a.getDashCooldownRemainingS() === 0;

describe('B1 — a press held from DashRecovery starts the next Dash with no second press', () => {
  for (const cooldownS of [DASH_COOLDOWN_RANGE.min, 1.5, 3]) {
    for (const pressDelayTicks of [1, 2]) {
      it(`cooldown ${cooldownS} s, Z pressed ${pressDelayTicks} tick(s) into the recovery and held`, () => {
        const attack = new AttackController(undefined, cooldownS);
        dashIntoRecovery(attack);
        for (let i = 1; i < pressDelayTicks; i++) attack.tick(input(false, false), 0, ORIGIN, FAR, DT);
        attack.tick(input(true, true), 0, ORIGIN, FAR, DT);
        // Allowed once the recovery is over AND the cooldown has run out (the cooldown started when the Dash ended).
        const allowedAfterS = Math.max(DASH_WHIFF_RECOVERY_S, cooldownS) - pressDelayTicks * DT;
        let chargedAt = -1;
        for (let t = 1; t < 600 && chargedAt < 0; t++) {
          if (attack.tick(input(true, false), 0, ORIGIN, FAR, DT).state === AttackState.ChargingDash) chargedAt = t;
        }
        expect(chargedAt).toBeGreaterThan(0);
        expect(Math.abs(chargedAt - allowedAfterS / DT)).toBeLessThanOrEqual(1.5);
        // ...and releasing it is a real Dash.
        for (let i = 0; i < 20; i++) attack.tick(input(true, false), 0, ORIGIN, FAR, DT);
        expect(attack.tick(input(false, false), 0, ORIGIN, FAR, DT).state).toBe(AttackState.DashActive);
      });
    }
  }

  it('a quick tap during the recovery, released before it ends, does nothing (no ghost attack)', () => {
    const attack = new AttackController(undefined, 1.5);
    dashIntoRecovery(attack);
    attack.tick(input(true, true), 0, ORIGIN, FAR, DT);
    const seen = new Set<AttackState>();
    for (let t = 0; t < 300; t++) seen.add(attack.tick(input(false, false), 0, ORIGIN, FAR, DT).state);
    expect(seen.has(AttackState.ChargingDash) || seen.has(AttackState.DashActive) || seen.has(AttackState.CircularActive)).toBe(false);
  });
});

describe('B2 — the CD line is full only when a Dash can really start', () => {
  for (const cooldownS of [DASH_COOLDOWN_RANGE.min, 0.75, 1.5, 3]) {
    it(`cooldown ${cooldownS} s: readiness 1 ⇔ a Dash can start, every tick from the Dash to ready`, () => {
      const attack = new AttackController(undefined, cooldownS);
      dashIntoRecovery(attack);
      const lies: string[] = [];
      let prev = -1;
      for (let t = 0; t < 400; t++) {
        attack.tick(input(false, false), 0, ORIGIN, FAR, DT);
        const ready = attack.getDashReadiness();
        if ((ready === 1) !== dashCanStart(attack)) lies.push(`tick ${t}: readiness ${ready.toFixed(3)}, state ${attack.getState()}, cooldown ${attack.getDashCooldownRemainingS().toFixed(3)}`);
        if (ready < prev - 1e-9) lies.push(`tick ${t}: readiness went down ${prev} -> ${ready}`);
        prev = ready;
      }
      expect(lies).toEqual([]);
    });
  }
});
