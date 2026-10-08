// Polish (owner, 2026-10-07, "prossiga com tudo menos a 2", idea 4): a drift broken by a launch (a wall, a hit) while X is
// still held is over — it used to re-arm on landing and start again by itself. Drifting again takes a fresh tap + hold.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const act = (held: Action[], pressed: Action[] = []): ControllerActions => ({ ...NONE, held: new Set(held), pressedThisFrame: new Set(pressed) });

async function harness(): Promise<CombatHarness> {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -20 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 25 }, { ...createDefaultMatchConfig(), arenaFloor: 'flat' });
  for (let i = 0; i < 40; i++) h.tick(NONE, NONE);
  return h;
}

describe('a drift broken by a launch does not restart by itself', () => {
  it('thrown into the air (past the grace) with X held: the drift ends, and landing with X still held does not drift again', async () => {
    const h = await harness();
    for (let i = 0; i < 20; i++) h.tick(act([Action.MoveForward]), NONE); // a short run-up
    // Tap, then press again and hold (tap + hold = drift), moving forward.
    h.tick(act([Action.MoveForward, Action.JumpDrift], [Action.JumpDrift]), NONE);
    h.tick(act([Action.MoveForward]), NONE);
    for (let t = 0; t < 4; t++) h.tick(act([Action.MoveForward]), NONE);
    h.tick(act([Action.MoveForward, Action.JumpDrift], [Action.JumpDrift]), NONE);
    let drifted = false;
    for (let t = 0; t < 60 && !drifted; t++) drifted = h.tick(act([Action.MoveForward, Action.JumpDrift]), NONE).first.driftState === 'Drifting';
    expect(drifted, 'the tap + hold starts the drift').toBe(true);

    // A launch (what a wall or a hit does): straight up, ~0.8 s in the air at the default gravity.
    const v = h.first.body.linvel();
    h.first.body.setLinvel({ x: v.x, y: 16, z: v.z }, true);
    const states: string[] = [];
    let lastAirborneTick = 0;
    for (let t = 0; t < 200; t++) {
      const r = h.tick(act([Action.JumpDrift]), NONE); // X never released (the Bey coasts: it must not reach the wall)
      states.push(r.first.driftState);
      if (!r.first.grounded) lastAirborneTick = t;
    }
    expect(lastAirborneTick, 'the launch kept the Bey in the air past the drift grace').toBeGreaterThan(30);
    expect(states.includes('Recovering'), 'the drift ended when the launch took the Bey off the floor').toBe(true);
    const afterLanding = states.slice(lastAirborneTick + 1);
    expect(afterLanding.length).toBeGreaterThan(20);
    expect(afterLanding.every((s) => s !== 'Drifting'), `no drift by itself after landing: ${[...new Set(afterLanding)].join(',')}`).toBe(true);

    // A fresh tap + hold drifts again.
    h.tick(act([Action.MoveForward]), NONE); // release
    for (let t = 0; t < 4; t++) h.tick(act([Action.MoveForward]), NONE);
    h.tick(act([Action.MoveForward, Action.JumpDrift], [Action.JumpDrift]), NONE);
    h.tick(act([Action.MoveForward]), NONE);
    for (let t = 0; t < 3; t++) h.tick(act([Action.MoveForward]), NONE);
    h.tick(act([Action.MoveForward, Action.JumpDrift], [Action.JumpDrift]), NONE);
    let again = false;
    for (let t = 0; t < 80 && !again; t++) again = h.tick(act([Action.MoveForward, Action.JumpDrift]), NONE).first.driftState === 'Drifting';
    expect(again, 'a fresh tap + hold after the break drifts again').toBe(true);
  });

  it('a drift released with X (the normal end) is unchanged: grip comes back and a new tap + hold drifts', async () => {
    const h = await harness();
    for (let i = 0; i < 20; i++) h.tick(act([Action.MoveForward]), NONE);
    h.tick(act([Action.MoveForward, Action.JumpDrift], [Action.JumpDrift]), NONE);
    h.tick(act([Action.MoveForward]), NONE);
    for (let t = 0; t < 4; t++) h.tick(act([Action.MoveForward]), NONE);
    h.tick(act([Action.MoveForward, Action.JumpDrift], [Action.JumpDrift]), NONE);
    let drifted = false;
    for (let t = 0; t < 60 && !drifted; t++) drifted = h.tick(act([Action.MoveForward, Action.JumpDrift]), NONE).first.driftState === 'Drifting';
    expect(drifted).toBe(true);
    const states: string[] = [];
    for (let t = 0; t < 40; t++) states.push(h.tick(act([Action.MoveForward]), NONE).first.driftState);
    expect(states).toContain('Recovering');
    expect(states.at(-1)).toBe('Idle');
  });
});
