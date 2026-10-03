// Owner, 2026-10-02 (Lote 4, item 6): the jump. Through the real tickMatch().
// - Drift rule: X + a lateral direction (left/right or diagonal) while moving
//   always drifts; X without one, or from a standstill, is a jump.
// - An X press made in the air (during a jump, a drift hop or a fall's
//   bounce) is kept and consumed on landing, once (PR #76's
//   pressDroppedWhileAirborne) — deterministic, no retries.
// - Full jump / short hop heights from MatchConfig, launch speed derived from
//   the apex with the world's gravity; falls still bounce physically.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { DriftState } from '../../src/drift/DriftController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };

type Dir = 'none' | 'forward' | 'left' | 'right' | 'forward-left' | 'back-right';
const HELD: Record<Dir, Action[]> = {
  none: [],
  forward: [Action.MoveForward],
  left: [Action.SteerLeft],
  right: [Action.SteerRight],
  'forward-left': [Action.MoveForward, Action.SteerLeft],
  'back-right': [Action.MoveBackward, Action.SteerRight],
};
const LATERAL: Record<Dir, boolean> = { none: false, forward: false, left: true, right: true, 'forward-left': true, 'back-right': true };

async function harness(overrides = {}): Promise<CombatHarness> {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -14 }, { x: 25, y: BEY_SPAWN_HEIGHT_M, z: 25 }, { arenaFloor: 'flat', ...overrides });
  for (let i = 0; i < 40; i++) h.tick(NONE, NONE);
  return h;
}

/** Drives at `speedMps` (0 = standing), then presses X with `dir` held for `pressTicks`; returns whether it drifted. */
async function drifts(dir: Dir, speedMps: number, pressTicks: number, directional: boolean): Promise<boolean> {
  const h = await harness();
  const run: ControllerActions = { ...NONE, held: new Set([Action.MoveForward]) };
  for (let i = 0; i < 80 && speedMps > 0; i++) {
    const v = h.first.body.linvel();
    const s = Math.hypot(v.x, v.z);
    if (s >= speedMps) {
      h.first.body.setLinvel({ x: (v.x / s) * speedMps, y: v.y, z: (v.z / s) * speedMps }, true);
      break;
    }
    h.tick(run, NONE);
  }
  let drifted = false;
  for (let t = 0; t < 90; t++) {
    const holdX = t < pressTicks;
    const held = new Set<Action>([...HELD[dir], ...(holdX ? [Action.JumpDrift] : [])]);
    // Directional control: the world intent plus SteerLeft/SteerRight kept as the screen's lateral input
    // (DirectionalController drops MoveForward/MoveBackward from held).
    const actions: ControllerActions = directional
      ? {
          ...NONE,
          held: new Set([...held].filter((a) => a !== Action.MoveForward && a !== Action.MoveBackward)),
          pressedThisFrame: new Set(t === 0 ? [Action.JumpDrift] : []),
          moveIntent: { x: held.has(Action.SteerRight) ? 0.7 : held.has(Action.SteerLeft) ? -0.7 : 0, z: held.has(Action.MoveBackward) ? -0.7 : dir === 'none' ? 0 : 0.7 },
        }
      : { ...NONE, held, pressedThisFrame: new Set(t === 0 ? [Action.JumpDrift] : []) };
    if (h.tick(actions, NONE).first.driftState === DriftState.Drifting) drifted = true;
  }
  h.dispose();
  return drifted;
}

describe('drift rule: X + lateral while moving always drifts (owner, 2026-10-02)', () => {
  for (const directional of [false, true]) {
    it(`${directional ? 'directional' : 'classic'} control: direction × speed × press length`, async () => {
      const wrong: string[] = [];
      for (const dir of Object.keys(HELD) as Dir[]) {
        for (const speed of [0, 6, 11]) {
          for (const press of [30, 60]) {
            const expected = LATERAL[dir] && speed > 0;
            const got = await drifts(dir, speed, press, directional);
            if (got !== expected) wrong.push(`${dir} @ ${speed} m/s, press ${press}: drift ${got}, expected ${expected}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    }, 120_000);
  }
});

/** Counts own takeoffs (grounded -> airborne) over `ticks`, feeding `actionAt(t)`. */
function countTakeoffs(h: CombatHarness, ticks: number, actionAt: (t: number) => ControllerActions): number {
  let was = isGrounded(h.physics, h.first.collider);
  let takeoffs = 0;
  for (let t = 0; t < ticks; t++) {
    h.tick(actionAt(t), NONE);
    const g = isGrounded(h.physics, h.first.collider);
    if (was && !g) takeoffs++;
    was = g;
  }
  return takeoffs;
}

const press = (t: number, at: number[], hold = 1): ControllerActions => {
  const down = at.some((p) => t >= p && t < p + hold);
  return { ...NONE, held: new Set(down ? [Action.JumpDrift] : []), pressedThisFrame: new Set(at.includes(t) ? [Action.JumpDrift] : []) };
};

describe('an X press in the air is kept and consumed on landing, once (PR #76)', () => {
  it('a second tap at any moment of a full jump gives exactly one more jump, right after landing — every tick of the flight', async () => {
    const failures: string[] = [];
    // A full jump (held 20 ticks) lasts ~84 ticks at the default 2.5 m; tap again at every airborne tick from 25 to 80.
    for (let second = 25; second <= 80; second += 1) {
      const h = await harness();
      const takeoffs = countTakeoffs(h, 260, (t) => {
        if (t < 20) return { ...NONE, held: new Set([Action.JumpDrift]), pressedThisFrame: new Set(t === 0 ? [Action.JumpDrift] : []) };
        return press(t, [second]);
      });
      if (takeoffs !== 2) failures.push(`tap at ${second}: ${takeoffs} takeoffs`);
      h.dispose();
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('no second tap: exactly one flight', async () => {
    const h = await harness();
    expect(countTakeoffs(h, 260, (t) => ({ ...NONE, held: new Set(t < 20 ? [Action.JumpDrift] : []), pressedThisFrame: new Set(t === 0 ? [Action.JumpDrift] : []) }))).toBe(1);
  });

  it('a tap during a fall\'s bounce is consumed on landing', async () => {
    const h = await harness();
    const p = h.first.body.translation();
    h.first.body.setTranslation({ x: p.x, y: p.y + 2, z: p.z }, true); // a fall, not a jump: it bounces physically
    let airborneTick = -1;
    let takeoffsAfterPress = 0;
    let was = false;
    for (let t = 0; t < 200; t++) {
      const g = isGrounded(h.physics, h.first.collider);
      if (airborneTick < 0 && t > 5 && !g) airborneTick = t;
      const a = airborneTick >= 0 && t === airborneTick + 2 ? press(t, [t]) : NONE;
      const r = h.tick(a, NONE);
      if (airborneTick >= 0 && t > airborneTick + 2 && r.first.driftState === DriftState.Hopping && !was) takeoffsAfterPress++;
      was = r.first.driftState === DriftState.Hopping;
    }
    expect(takeoffsAfterPress).toBe(1);
  });
});

describe('jump heights (owner, 2026-10-02): full 2.5 m provisional, short hop ~0.13 m, both Pregame sliders', () => {
  async function apex(holdTicks: number, overrides = {}): Promise<number> {
    const h = await harness(overrides);
    const base = h.first.body.translation().y;
    let top = base;
    for (let t = 0; t < 200; t++) {
      h.tick({ ...NONE, held: new Set(t < holdTicks ? [Action.JumpDrift] : []), pressedThisFrame: new Set(t === 0 ? [Action.JumpDrift] : []) }, NONE);
      top = Math.max(top, h.first.body.translation().y);
    }
    h.dispose();
    return top - base;
  }

  it('a held jump reaches the configured apex (default 2.5 m, and 1 m / 5 m at the slider ends)', async () => {
    expect(await apex(40)).toBeCloseTo(2.5, 1);
    expect(await apex(40, { jumpFullHeightM: 1 })).toBeCloseTo(1, 1);
    expect(await apex(40, { jumpFullHeightM: 5 })).toBeCloseTo(5, 1);
  });

  it('a tap stays a short hop and follows the Short hop height slider', async () => {
    // Measured body rise (the slider sets the arc's own target; one tick of launch rises before the release cut can
    // act): 0.205 m with the old 1.19 m full jump, 0.242 m with the new 2.5 m default — the approved one-impulse rule
    // (no re-acceleration after launch) keeps that one tick.
    const tap = await apex(1);
    expect(tap).toBeLessThan(0.26);
    expect(tap).toBeLessThan(0.1 * (await apex(40)));
    expect(await apex(1, { jumpShortHopHeightM: 0.5 })).toBeGreaterThan(tap + 0.3);
    expect(await apex(1, { jumpShortHopHeightM: 0.05 })).toBeLessThanOrEqual(tap);
  });

  it('a fall still bounces physically (only the Bey\'s own jump lands without a bounce)', async () => {
    const h = await harness();
    const p = h.first.body.translation();
    h.first.body.setTranslation({ x: p.x, y: p.y + 2, z: p.z }, true);
    let landed = false;
    let bounceTop = 0;
    let wasG = false;
    for (let t = 0; t < 120; t++) {
      h.tick(NONE, NONE);
      const g = isGrounded(h.physics, h.first.collider);
      if (!wasG && g) landed = true;
      if (landed) bounceTop = Math.max(bounceTop, h.first.body.translation().y - p.y);
      wasG = g;
    }
    expect(bounceTop).toBeGreaterThan(0.03);
  });

  it('the AI still plays whole rounds at both slider ends (1 m and 5 m)', async () => {
    for (const jumpFullHeightM of [1, 5]) {
      const record = await simulateAiMatch({ seed: `jump-${jumpFullHeightM}`, firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, matchConfigOverrides: { jumpFullHeightM } });
      expect(record.stats.outcome, `${jumpFullHeightM} m`).not.toBe(RoundOutcome.Ongoing);
      expect(record.anomalies, `${jumpFullHeightM} m`).toEqual([]);
    }
  }, 120_000);
});
