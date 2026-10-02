// ============================================================
// MOTION DIRECTIONS A / B / C (M11) — the approved Motion Lab movement,
// integrated into the real controllers (bey/motion/MotionPresets.ts).
// Checks that the game carries the Lab's exact values, that each
// behaviour the Lab demonstrates happens in the real Rapier simulation and
// orders A (Stable Arcade) < B (Physical Hybrid) < C (Wild Mechanical) the
// way the Lab measured, that the physics stays upright and finite, and
// that the choice is gameplay: deterministic and recorded in replays.
// ============================================================

import { SLIP_GRIP_FLOOR_MULTIPLIER } from '../../src/bey/movement/MovementTuning';
import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
import { describe, expect, it } from 'vitest';
import { PRESETS as LAB_PRESETS } from '../../prototypes/bey-motion-concepts/src/physics/params';
import { MOTION_DIRECTIONS, MOTION_DIRECTION_IDS, DEFAULT_MOTION_DIRECTION, type MotionDirectionId } from '../../src/bey/motion/MotionPresets';
import { applyKnockback } from '../../src/combat/knockback/Knockback';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { decodeReplay, encodeReplay, sealReplay } from '../../src/replay/format/ChaosBeyReplayV1';
import { currentRuntimeFingerprint } from '../../src/replay/format/runtimeFingerprint';
import { playReplayHeadless } from '../../src/replay/playback/replayPlayback';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { TestBeyHarness } from './physicsHarness';

const params = (id: MotionDirectionId) => MOTION_DIRECTIONS[id].params;
const held = (...actions: Action[]): ControllerActions => ({ held: new Set(actions), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 });
const IDLE = held();

async function harness(id: MotionDirectionId, spawn = { x: 0, y: 1, z: -10.5 }): Promise<TestBeyHarness> {
  const h = await TestBeyHarness.create(spawn, params(id));
  h.tickMany(IDLE, 150); // land and settle (C bounces for a while), heading 0 (+Z)
  return h;
}

describe('motion directions — the approved Motion Lab presets', () => {
  it('carry the Lab\'s 33 values exactly, B is the default, and B keeps the game\'s planar numbers', () => {
    for (const lab of LAB_PRESETS) expect(MOTION_DIRECTIONS[lab.id].params).toEqual(lab.params);
    expect(MOTION_DIRECTION_IDS).toEqual(['A', 'B', 'C']);
    expect(DEFAULT_MOTION_DIRECTION).toBe('B');
    expect(createDefaultMatchConfig().motion).toBe('B');
    expect(params('B')).toMatchObject({ accel: 14, maxSpeed: 11, turnRate: 2.6, lateralGrip: 5.5, airGrip: 0.4, wobbleAmplitude: 6, wobbleFrequency: 7 });
  });
});

describe('motion directions — the Lab\'s behaviours in the real simulation', () => {
  it('drive: holds top speed under throttle (thrust stops there), and slows once released', async () => {
    for (const id of MOTION_DIRECTION_IDS) {
      const h = await harness(id);
      // The floor's contact friction (kept from the game, see
      // createArenaColliders) also acts, so the climb is slower than the
      // Lab's 14 m/s² and the plateau sits a hair under top speed.
      const driving = h.tickMany(held(Action.MoveForward), 130);
      const plateau = driving.slice(100).map((r) => r.movement.speedMps);
      for (const v of plateau) {
        expect(v, `${id}: at top speed`).toBeGreaterThan(params(id).maxSpeed - 0.2);
        expect(v, `${id}: never above top speed from thrust`).toBeLessThanOrEqual(params(id).maxSpeed + 0.01);
      }
      const coast = h.tickMany(IDLE, 60);
      // Rolling drag (longitudinalGrip) and the floor's friction, together.
      expect(coast.at(-1)!.movement.speedMps, `${id}: one second of coasting`).toBeLessThan(plateau.at(-1)! * Math.exp(-params(id).longitudinalGrip));
    }
  });

  it('grip / slip: a hard turn at top speed breaks the tip loose more, and longer, the wilder the direction; grip always comes back', async () => {
    const minGrip: Record<string, number> = {};
    const slipTicks: Record<string, number> = {};
    for (const id of MOTION_DIRECTION_IDS) {
      const h = await harness(id);
      h.tickMany(held(Action.MoveForward), 100);
      // A hard turn under throttle at top speed (with the floor's friction a
      // coasting turn no longer breaks B loose; under throttle it does).
      const turn = h.tickMany(held(Action.MoveForward, Action.SteerRight), 50);
      const slide = h.tickMany(IDLE, 60);
      const all = [...turn, ...slide];
      // Stopped at the centre (away from the wall, whose impacts would drop grip again) to watch grip come back.
      h.beyBody.setTranslation({ x: 0, y: h.beyBody.translation().y, z: 0 }, true);
      h.beyBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      const after = h.tickMany(IDLE, 240);
      minGrip[id] = Math.min(...all.map((r) => r.movement.gripFactor));
      slipTicks[id] = all.filter((r) => r.movement.isSlipping).length;
      expect(after.at(-1)!.movement.gripFactor, `${id}: grip recovered`).toBeGreaterThan(0.99);
      expect(after.at(-1)!.movement.isSlipping).toBe(false);
    }
    expect(minGrip.A).toBeGreaterThan(minGrip.B!);
    expect(minGrip.B).toBeGreaterThan(minGrip.C!);
    // How low the grip multiplier falls once slipping is the direction's slipGrip
    // x SLIP_GRIP_FLOOR_MULTIPLIER (MovementTuning.ts). These used to read
    // plain slipGrip, but only because the old 12 m arena's wall was hit during
    // the run (an impact drops grip to slipGrip itself); on the 36 m arena the
    // run no longer reaches a wall, so the slip model's own floor shows.
    expect(minGrip.B).toBeCloseTo(Math.min(1, params('B').slipGrip * SLIP_GRIP_FLOOR_MULTIPLIER), 2);
    expect(minGrip.C).toBeCloseTo(Math.min(1, params('C').slipGrip * SLIP_GRIP_FLOOR_MULTIPLIER), 2);
    expect(slipTicks.B).toBeGreaterThan(0);
    expect(slipTicks.C).toBeGreaterThan(slipTicks.A!);
  });

  it('wall bounce: a head-on hit at 9+ m/s rebounds A < B < C, and never comes back faster than it went in', async () => {
    const rebound: Record<string, number> = {};
    for (const id of MOTION_DIRECTION_IDS) {
      const h = await harness(id, { x: 0, y: 1, z: ARENA_FLOOR_RADIUS - 4 }); // 4 m from the wall, as the 8 m spawn was on the 12 m arena
      h.beyBody.setLinvel({ x: 0, y: 0, z: 9 }, true);
      let fastestBack = 0;
      // Driven into the wall (forward held): with no input the idle damping
      // (owner playtest, after M11) settles a Bey before it covers the 3 m.
      let fastestIn = 9;
      for (const r of h.tickMany(held(Action.MoveForward), 60)) {
        fastestIn = Math.max(fastestIn, r.movement.actualVelocityVector.z);
        fastestBack = Math.max(fastestBack, -r.movement.actualVelocityVector.z);
      }
      rebound[id] = fastestBack;
      expect(fastestBack, `${id}: bounced back`).toBeGreaterThan(0.5);
      expect(fastestBack, `${id}: no energy gained`).toBeLessThan(fastestIn);
    }
    expect(rebound.A).toBeLessThan(rebound.B!);
    expect(rebound.B).toBeLessThan(rebound.C!);
  });

  it('knockback: the direction scales the launch and sends knockbackLift of it upward (the Lab\'s shape)', async () => {
    for (const id of MOTION_DIRECTION_IDS) {
      const h = await harness(id, { x: 0, y: 1, z: 0 });
      const before = h.beyBody.linvel();
      applyKnockback(h.beyBody, { x: 0, z: -1 }, { x: 0, z: 0 }, { force: 10, impulseMagnitude: 6, upwardImpulseMagnitude: 2.1 }, params(id));
      const v = h.beyBody.linvel();
      const horizontal = v.z - before.z;
      const vertical = v.y - before.y;
      expect(horizontal * h.beyBody.mass(), `${id}: horizontal impulse`).toBeCloseTo(6 * params(id).knockbackScale, 5);
      expect(vertical / horizontal, `${id}: lift`).toBeCloseTo(params(id).knockbackLift, 5);
    }
  });

  it('impact attitude: the same hit leans A < B < C (visual layer), tumbles only past the threshold, and the physics body is back upright in every direction', async () => {
    const peak: Record<string, number> = {};
    for (const id of MOTION_DIRECTION_IDS) {
      const h = await harness(id, { x: 0, y: 1, z: 0 });
      h.spin.registerImpact(h.beyBody, 8, { x: 0, z: 1 });
      let maxLean = 0;
      let tumbled = false;
      let last = h.tick(IDLE);
      for (let i = 0; i < 180; i++) {
        last = h.tick(IDLE);
        maxLean = Math.max(maxLean, Math.hypot(last.spin.lean.x, last.spin.lean.z));
        tumbled ||= last.spin.isTumbling;
        expect(Number.isFinite(last.spin.tiltRad) && Number.isFinite(last.spin.lean.x) && Number.isFinite(last.spin.lean.z)).toBe(true);
      }
      peak[id] = maxLean;
      expect(tumbled, `${id}: 8 m/s of velocity change is below every tumble threshold`).toBe(false);
      expect(last.spin.tiltRad, `${id}: physics tilt recovered`).toBeLessThan(0.1);
      expect(Math.hypot(last.spin.lean.x, last.spin.lean.z), `${id}: attitude recovered`).toBeLessThan((2 * Math.PI) / 180);
    }
    expect(peak.A).toBeLessThan(peak.B!);
    expect(peak.B).toBeLessThan(peak.C!);
  });

  it('tumble: 11 m/s of velocity change (11 / (1 + wallBounce) incoming) tumbles only C, whose threshold is 6 m/s', async () => {
    for (const id of MOTION_DIRECTION_IDS) {
      const h = await harness(id, { x: 0, y: 1, z: 0 });
      h.spin.registerImpact(h.beyBody, 11, { x: 0, z: 1 });
      const r = h.tick(IDLE);
      expect(r.spin.isTumbling, id).toBe(id === 'C');
      expect(r.spin.recoveryFraction, `${id}: upright spring faded after the hit`).toBeLessThan(0.5);
    }
  });

  it('lean: accelerating tips the top forward, into the motion, and never past the direction\'s maxTilt', async () => {
    for (const id of MOTION_DIRECTION_IDS) {
      const h = await harness(id);
      const results = h.tickMany(held(Action.MoveForward), 30);
      const lean = results.at(-1)!.spin.lean;
      expect(lean.z, `${id}: leans toward +Z (forward)`).toBeGreaterThan(0);
      for (const r of results) expect(Math.hypot(r.spin.lean.x, r.spin.lean.z)).toBeLessThanOrEqual((params(id).maxTilt * Math.PI) / 180 + 1e-9);
    }
  });
});

describe('motion directions — gameplay: deterministic and recorded', () => {
  it('the same match with the same direction repeats exactly; another direction plays a different fight', async () => {
    const run = (motion: MotionDirectionId) => simulateAiMatch({ seed: 'motion-determinism', firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 900, matchConfigOverrides: { motion } });
    const a = await run('C');
    const b = await run('C');
    expect(b.stats).toEqual(a.stats);
    const other = await run('A');
    expect(other.stats).not.toEqual(a.stats);
  }, 60_000);

  it('a replay records the direction and plays back verified; one from before the option is valid (plays as B); a bad one is refused', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    for (const motion of MOTION_DIRECTION_IDS) {
      const rec = await simulateAiMatch({ seed: `motion-replay/${motion}`, firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 600, matchConfigOverrides: { motion }, record: { fingerprint, checkpointEvery: 30 } });
      const decoded = decodeReplay(encodeReplay(rec.replay!));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      expect(decoded.replay.config.matchConfig.motion).toBe(motion);
      expect(await playReplayHeadless(decoded.replay, fingerprint)).toMatchObject({ status: 'verified' });
    }

    const b = await simulateAiMatch({ seed: 'motion-legacy', firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 300, record: { fingerprint, checkpointEvery: 30 } });
    const raw = JSON.parse(encodeReplay(b.replay!));
    delete raw.config.matchConfig.motion;
    const { integrity: _i, ...unsealed } = raw;
    const legacy = decodeReplay(JSON.stringify(sealReplay(unsealed)));
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(await playReplayHeadless(legacy.replay, fingerprint)).toMatchObject({ status: 'verified' });

    const bad = JSON.parse(encodeReplay(b.replay!));
    bad.config.matchConfig.motion = 'D';
    const { integrity: _j, ...badUnsealed } = bad;
    const refused = decodeReplay(JSON.stringify(sealReplay(badUnsealed)));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors.map((e) => e.path)).toContain('config.matchConfig.motion');
  }, 120_000);
});
