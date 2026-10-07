// Polish (owner, 2026-10-07, idea 5): nothing throws a Bey faster than LAUNCH_SPEED_CEILING_MPS. Found by a sweep of AI
// matches at every Pregame slider's extremes: Knockback x4 launched a Bey at 261 m/s (the physics-safety limit is 200).

import { describe, expect, it } from 'vitest';
import { BEY_ROSTER } from '../../src/app/frontend/beyRoster';
import { LAUNCH_SPEED_CEILING_MPS } from '../../src/combat/knockback/KnockbackTuning';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { HARNESS_FIRST_SPAWN, HARNESS_SECOND_SPAWN } from './combatHarness';

async function topSpeedOf(overrides: Record<string, unknown>): Promise<{ topSpeed: number; farthestStepM: number; anomalies: number; invalid: number }> {
  let topSpeed = 0;
  let farthestStep = 0;
  const last: Record<string, { x: number; y: number; z: number }> = {};
  const record = await simulateAiMatch({
    seed: 'sweep-B-knockbackScale-max', // the seed that threw a Bey at 261 m/s before the ceiling
    firstSpawn: HARNESS_FIRST_SPAWN,
    secondSpawn: HARNESS_SECOND_SPAWN,
    firstDefinition: BEY_ROSTER[0]!.definition,
    secondDefinition: BEY_ROSTER[3]!.definition,
    maxTicks: 1500,
    matchConfigOverrides: overrides as never,
    onTick: (_tick, world) => {
      for (const [side, bey] of [['first', world.first], ['second', world.second]] as const) {
        const v = bey.body.linvel();
        topSpeed = Math.max(topSpeed, Math.hypot(v.x, v.y, v.z));
        // What matters for a wall 0.6 m thick is how far a Bey moves in one tick (a launch applied late in a tick is cut before the next step).
        const p = bey.body.translation();
        const before = last[side];
        if (before) farthestStep = Math.max(farthestStep, Math.hypot(p.x - before.x, p.y - before.y, p.z - before.z));
        last[side] = { x: p.x, y: p.y, z: p.z };
      }
    },
  });
  return { topSpeed, farthestStepM: farthestStep, anomalies: record.anomalyCount, invalid: record.invalidDetectionCount };
}

describe('launch speed ceiling', () => {
  it('Knockback x4 (the slider\'s maximum) never moves a Bey farther in a tick than the ceiling allows, with no physics anomaly', async () => {
    const r = await topSpeedOf({ knockbackScale: 4 });
    expect(r.farthestStepM).toBeLessThanOrEqual((LAUNCH_SPEED_CEILING_MPS / 60) * 1.02);
    expect(r.anomalies).toBe(0);
    expect(r.invalid).toBe(0);
  }, 60_000);

  it('Clash knockback 60 m/s x Knockback x4 is held to it too', async () => {
    const r = await topSpeedOf({ knockbackScale: 4, clashLaunchMps: 60 });
    expect(r.farthestStepM).toBeLessThanOrEqual((LAUNCH_SPEED_CEILING_MPS / 60) * 1.02);
    expect(r.anomalies).toBe(0);
  }, 60_000);

  it('the ceiling sits above everything normal play reaches (the default match never gets near it)', async () => {
    const r = await topSpeedOf({});
    expect(r.topSpeed).toBeLessThan(LAUNCH_SPEED_CEILING_MPS * 0.9);
  }, 60_000);
});
