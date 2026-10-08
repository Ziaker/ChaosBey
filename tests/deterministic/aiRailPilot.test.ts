// Owner, 2026-10-08 ("a AI deve usar rails"): the AI runs the rails (RailPilot): it gets onto one by jumping toward it, charges its
// Dash there and jumps off. Guards that it does, that it never stays on a rail, and that with the Pregame option off it never tries.

import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';

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
});
