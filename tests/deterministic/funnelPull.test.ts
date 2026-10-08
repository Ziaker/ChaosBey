// Owner, 2026-10-08 ("a física não tá sendo aplicada ... o bey só deveria ser capaz de ficar completamente parado quando
// estivesse dentro do funil, na parte plana"): the floor's slope pulls every Bey toward the centre (MatchConfig.funnelPull).
// Before, the handling model rewrote the horizontal velocity every tick and its idle damping ate the slope's gravity: a Bey
// let go at r = 25 m on the 8.5 m funnel crept at ~1 m/s (14 m in 12 s) and one at r = 3 m did not move at all.

import { describe, expect, it } from 'vitest';
import { floorHeightAt, type ArenaFloorId } from '../../src/arena/floor/ArenaFloorProfile';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import type { CombatController, ControllerActions } from '../../src/input/actions/Action';
import { SelfTestMatchWorld } from '../../src/self-test/SelfTestMatchWorld';

const TICKS_PER_S = 60;

function holding(x: number, z: number, strength: number): CombatController {
  const len = Math.hypot(x, z) || 1;
  const actions: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0, moveIntent: { x: (x / len) * strength, z: (z / len) * strength } };
  return { sampleActions: () => actions };
}

interface Run {
  readonly radiusAt: (seconds: number) => number;
  readonly speedAt: (seconds: number) => number;
  readonly peakSpeed: number;
  readonly headingDrift: number;
}

/** A Bey placed at (startR, 0) with the controller driving it, the opponent parked out of the way, for `seconds`. */
async function run(overrides: { funnelPull?: number; arenaFloor?: ArenaFloorId }, startR: number, controller: CombatController, seconds: number): Promise<Run> {
  const world = await SelfTestMatchWorld.build({ firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, aiMashSource: new NullAiMashSource(), matchConfigOverrides: overrides as never });
  const b = world.first;
  b.body.setTranslation({ x: startR, y: BEY_SPAWN_HEIGHT_M + floorHeightAt(b.arenaFloor, startR, 0), z: 0 }, true);
  b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.movement.debugSetHeading(Math.PI / 2);
  const heading0 = b.movement.getHeadingRad();
  const idle = new IdleController();
  const radius: number[] = [];
  const speed: number[] = [];
  let peak = 0;
  for (let t = 0; t < seconds * TICKS_PER_S; t++) {
    // Parked, still, on the floor: it must not end the round (a Bey outside the arena would).
    world.second.body.setTranslation({ x: 0, y: BEY_SPAWN_HEIGHT_M + floorHeightAt(world.second.arenaFloor, 0, -33), z: -33 }, true);
    world.second.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    world.step({ first: controller, second: idle });
    const p = b.body.translation();
    const v = b.body.linvel();
    radius.push(Math.hypot(p.x, p.z));
    speed.push(Math.hypot(v.x, v.z));
    peak = Math.max(peak, speed[speed.length - 1]!);
  }
  const headingDrift = Math.abs(b.movement.getHeadingRad() - heading0);
  world.dispose();
  return { radiusAt: (s) => radius[Math.min(radius.length - 1, Math.round(s * TICKS_PER_S) - 1)]!, speedAt: (s) => speed[Math.min(speed.length - 1, Math.round(s * TICKS_PER_S) - 1)]!, peakSpeed: peak, headingDrift };
}

describe('funnel pull (owner, 2026-10-08)', () => {
  it('a Bey let go on the funnel slides down it and rests only at the flat bottom', async () => {
    const pulled = await run({ funnelPull: 1 }, 25, new IdleController(), 10);
    expect(pulled.peakSpeed).toBeGreaterThan(5); // it really picks up speed on the way down
    expect(pulled.radiusAt(6)).toBeLessThan(2); // in the bottom within ~6 s (was 14 m after 12 s)
    expect(pulled.radiusAt(10)).toBeLessThan(0.5);
    expect(pulled.speedAt(10)).toBeLessThan(0.1); // completely still — and only there
    // Before the pull it crept and stood still on the slope.
    const legacy = await run({ funnelPull: 0 }, 25, new IdleController(), 10);
    expect(legacy.peakSpeed).toBeLessThan(2);
    expect(legacy.radiusAt(10)).toBeGreaterThan(14);
  }, 120_000);

  it('a Bey on a gentle slope near the centre no longer stands still on it', async () => {
    const pulled = await run({ funnelPull: 1 }, 3, new IdleController(), 5);
    expect(pulled.radiusAt(5)).toBeLessThan(0.5);
    const legacy = await run({ funnelPull: 0 }, 3, new IdleController(), 5);
    expect(legacy.radiusAt(5)).toBeGreaterThan(2.9);
  }, 120_000);

  it('on a flat floor there is no pull: the Bey stays where it was put', async () => {
    const flat = await run({ funnelPull: 3, arenaFloor: 'flat' }, 10, new IdleController(), 4);
    expect(flat.radiusAt(4)).toBeCloseTo(10, 1);
    expect(flat.peakSpeed).toBeLessThan(0.2);
  }, 120_000);

  it('a stronger pull is faster', async () => {
    const weak = await run({ funnelPull: 0.5 }, 25, new IdleController(), 3);
    const strong = await run({ funnelPull: 2 }, 25, new IdleController(), 3);
    expect(strong.radiusAt(3)).toBeLessThan(weak.radiusAt(3));
    expect(strong.peakSpeed).toBeGreaterThan(weak.peakSpeed);
  }, 120_000);

  it('the controls are untouched: a light stick still leaves the centre, and the pull never turns the Bey', async () => {
    const light = await run({ funnelPull: 1 }, 0, holding(1, 0, 0.35), 3);
    expect(light.radiusAt(3)).toBeGreaterThan(8);
    const idle = await run({ funnelPull: 2 }, 25, new IdleController(), 3);
    expect(idle.headingDrift).toBeLessThan(0.05); // it slides, it does not spin round: the heading is the player's
  }, 120_000);
});
