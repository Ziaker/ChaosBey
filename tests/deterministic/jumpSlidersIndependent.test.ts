// Owner audit B6, 2026-10-03: the Full jump slider controls the full jump only. Short hop and drift hop heights are
// identical whatever Full jump is (1 / 2.5 / 5 m), and the full jump reaches its own setting — through the real
// tickMatch(), one press = one launch (no re-acceleration, no second takeoff).

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { DriftState } from '../../src/drift/DriftController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
type Kind = 'short hop' | 'drift hop' | 'full jump';
const DRIFT_SECOND_PRESS_TICK = 4;

async function flight(kind: Kind, jumpFullHeightM: number) {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -14 }, { x: 25, y: BEY_SPAWN_HEIGHT_M, z: 25 }, { arenaFloor: 'flat', jumpFullHeightM });
  for (let i = 0; i < 40; i++) h.tick(NONE, NONE);
  const moving = kind === 'drift hop';
  for (let i = 0; i < 40 && moving; i++) h.tick({ ...NONE, held: new Set([Action.MoveForward]) }, NONE);
  const base = h.first.body.translation().y;
  let apex = base;
  let takeoffs = 0;
  let upwardKicks = 0;
  let was = isGrounded(h.physics, h.first.collider);
  let prevVy = h.first.body.linvel().y;
  let drifted = false;
  let takeoffTick = Infinity; // owner, 2026-10-04: the full jump leaves the floor once the hold is known (tick ~7), not on tick 1
  for (let t = 0; t < 200; t++) {
    // The drift is tap + hold (owner, 2026-10-04): tap X for the hop, then press X again (tick 4, in the air) and hold
    // it while steering. Holding X from the first press is the full jump whatever the steering.
    const holdX = kind === 'full jump' ? t < 40 : kind === 'drift hop' ? t < 2 || (t >= DRIFT_SECOND_PRESS_TICK && t < 60) : t < 1;
    const held = new Set<Action>([...(holdX ? [Action.JumpDrift] : []), ...(moving ? [Action.MoveForward, Action.SteerRight] : [])]);
    const pressedX = t === 0 || (kind === 'drift hop' && t === DRIFT_SECOND_PRESS_TICK);
    const r = h.tick({ ...NONE, held, pressedThisFrame: new Set(pressedX ? [Action.JumpDrift] : []) }, NONE);
    if (r.first.driftState === DriftState.Drifting) drifted = true;
    const g = isGrounded(h.physics, h.first.collider);
    if (was && !g) {
      takeoffs++;
      takeoffTick = t;
    }
    was = g;
    const vy = h.first.body.linvel().y;
    if (t > takeoffTick && !g && vy > prevVy + 0.05) upwardKicks++; // re-acceleration in flight
    prevVy = vy;
    apex = Math.max(apex, h.first.body.translation().y);
  }
  h.dispose();
  return { apexM: apex - base, takeoffs, upwardKicks, drifted };
}

describe('B6 — Full jump does not change the short hop or the drift hop', () => {
  for (const kind of ['short hop', 'drift hop'] as const) {
    it(`${kind}: the same height at Full jump 1, 2.5 and 5 m`, async () => {
      const r = await Promise.all([1, 2.5, 5].map((m) => flight(kind, m)));
      for (const x of r) {
        expect(x.takeoffs).toBe(1);
        expect(x.upwardKicks).toBe(0);
        // Owner, 2026-10-05: the drift press made in the air drops the hop straight to the floor (it peaks at ~0.048 m).
        expect(x.apexM).toBeGreaterThan(kind === 'drift hop' ? 0.02 : 0.05);
        expect(x.apexM).toBeLessThan(0.2);
      }
      expect(r[1]!.apexM).toBeCloseTo(r[0]!.apexM, 6);
      expect(r[2]!.apexM).toBeCloseTo(r[0]!.apexM, 6);
      if (kind === 'drift hop') for (const x of r) expect(x.drifted).toBe(true);
    }, 60_000);
  }

  it('full jump: reaches each setting (1 / 2.5 / 5 m), one takeoff, no re-acceleration', async () => {
    for (const m of [1, 2.5, 5]) {
      const x = await flight('full jump', m);
      expect(x.takeoffs).toBe(1);
      expect(x.upwardKicks).toBe(0);
      expect(x.apexM).toBeCloseTo(m, 1);
    }
  }, 60_000);
});
