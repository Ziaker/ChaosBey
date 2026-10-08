// Owner, 2026-10-08 ("a AI deve usar rails"): the AI runs the rails (RailPilot): it gets onto one by jumping toward it, charges its
// Dash there and jumps off. Guards that it does, that it never stays on a rail, and that with the Pregame option off it never tries.

import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { Action } from '../../src/input/actions/Action';
import { ClashState } from '../../src/combat/clash/ClashController';

const PAIRS = [
  [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE],
  [DEFENSE_ARCHETYPE, ATTACK_ARCHETYPE],
  [STAMINA_ARCHETYPE, DEFENSE_ARCHETYPE],
  [ATTACK_ARCHETYPE, STAMINA_ARCHETYPE],
] as const;

describe('AI rail runs', () => {
  it('the AI grabs rails in AI-vs-AI rounds, and never stays on one', async () => {
    let rides = 0;
    let longestRideS = 0;
    for (const [a, b] of PAIRS) {
      for (let i = 0; i < 3; i++) {
        const r = await simulateAiMatch({
          seed: `rail-pilot-${a.id}-${b.id}-${i}`,
          firstDefinition: a,
          secondDefinition: b,
          onTick: (_tick, world) => {
            longestRideS = Math.max(longestRideS, world.first.rail.getState().timeOnRailS, world.second.rail.getState().timeOnRailS);
          },
        });
        rides += r.stats.first.railRides + r.stats.second.railRides;
      }
    }
    expect(rides).toBeGreaterThan(0);
    expect(longestRideS).toBeLessThan(8);
  }, 300_000);

  it('with the Rails option off the AI never rides', async () => {
    let rides = 0;
    for (const [a, b] of PAIRS) {
      const r = await simulateAiMatch({ seed: `rail-pilot-off-${a.id}-${b.id}`, firstDefinition: a, secondDefinition: b, matchConfigOverrides: { railsEnabled: false } });
      rides += r.stats.first.railRides + r.stats.second.railRides;
    }
    expect(rides).toBe(0);
  }, 300_000);

  it('an AI whose opponent is on a rail (out of the arena, untouchable) does not chase or attack it', async () => {
    let attackPresses = 0;
    let railTicks = 0;
    let forced = false;
    await simulateAiMatch({
      seed: 'rail-opponent-ignored',
      firstDefinition: ATTACK_ARCHETYPE,
      secondDefinition: ATTACK_ARCHETYPE,
      maxTicks: 900,
      onTick: (tick, world, _firstActions, secondActions, _firstAi, secondAi) => {
        const rail = world.first.rail as unknown as { rails: readonly { id: string; path: { sampleAt(s: number): { position: { x: number; y: number; z: number } } } }[]; railIndex: number; state: unknown };
        if (tick >= 120 && !forced && world.clash.controller.getState() !== ClashState.Active) {
          forced = true;
          // Put the first Bey on the first rail from its gate (a test-only shortcut: the controller's own state).
          const p = rail.rails[0]!.path.sampleAt(0).position;
          world.first.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
          rail.railIndex = 0;
          rail.state = { railId: rail.rails[0]!.id, progressM: 0, direction: 1, speedMps: 8, entrySpeedMps: 8, timeOnRailS: 0, entryReason: 'jump', exitReason: null };
        }
        if (forced && world.first.rail.isOnRail()) {
          railTicks++;
          if (secondActions.pressedThisFrame.has(Action.Attack) && !secondAi.isRunningRail() && world.clash.controller.getState() !== ClashState.Active) attackPresses++;
        }
      },
    });
    expect(railTicks).toBeGreaterThan(60);
    expect(attackPresses).toBe(0);
  }, 120_000);
});
