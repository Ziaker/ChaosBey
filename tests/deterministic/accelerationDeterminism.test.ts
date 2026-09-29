// M9 lane E (hardening): acceleration never changes the simulation. The
// browser Self Test advances a batch 1, 4, 16 or 64 fixed ticks per frame,
// or in 60-tick chunks at max speed (GDD 164: acceleration runs more ticks,
// never a bigger delta). Whatever the pacing, every match must go through
// the same states, tick for tick, and end the same way.

import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { stateHash } from '../../src/replay/state/stateHash';
import { AiBatchSession, type AiBatchConfig, type AiBatchMatchEntry } from '../../src/self-test/AiBatchRunner';

const MATCHUPS: AiBatchConfig['matchups'] = [
  { firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE },
  { firstDefinition: STAMINA_ARCHETYPE, secondDefinition: ATTACK_ARCHETYPE },
  { firstDefinition: DEFENSE_ARCHETYPE, secondDefinition: STAMINA_ARCHETYPE },
];
const SEEDS = ['accel-a', 'accel-b'];

interface PacedRun {
  /** Per match seed: the canonical state hash after every tick. */
  readonly hashes: Map<string, string[]>;
  /** The batch entries without their wall-clock timing. */
  readonly entries: unknown[];
  /** How many steps ("frames") the batch took. */
  readonly frames: number;
}

/** Wall-clock fields (tick duration) legitimately differ between runs; everything else must not. */
function withoutTiming(entry: AiBatchMatchEntry): unknown {
  const { maxTickMs: _maxTickMs, slowTicks: _slowTicks, ...rest } = entry;
  return rest;
}

/** Runs the batch, asking `nextBudget()` how many ticks each step may run (one "frame"). */
async function runPaced(nextBudget: () => number): Promise<PacedRun> {
  const hashes = new Map<string, string[]>();
  let current: string[] = [];
  const session = new AiBatchSession({
    matchups: MATCHUPS,
    seeds: SEEDS,
    maxTicks: 1500,
    onTick: (tick, world) => {
      if (tick === 0) {
        current = [];
        hashes.set(`${hashes.size}`, current);
      }
      current.push(stateHash(world.getCanonicalState(tick + 1)));
    },
  });
  let frames = 1;
  while (!(await session.step(nextBudget()))) frames++;
  return { hashes, entries: session.report().entries.map(withoutTiming), frames };
}

describe('acceleration determinism (GDD 164, M9 lane E)', () => {
  it('1, 4, 16, 64 ticks per frame, 60-tick max-speed chunks, one go and an irregular pacing all give identical matches, tick for tick', async () => {
    const reference = await runPaced(() => Number.POSITIVE_INFINITY);
    const totalTicks = [...reference.hashes.values()].reduce((sum, list) => sum + list.length, 0);
    // Not vacuous: six real matches, thousands of ticks.
    expect(reference.hashes.size).toBe(MATCHUPS.length * SEEDS.length);
    expect(totalTicks).toBeGreaterThan(1500);
    expect(reference.frames).toBe(1);

    let irregular = 0;
    const pacings: [string, () => number][] = [
      ['1×', () => 1],
      ['4×', () => 4],
      ['16×', () => 16],
      ['64×', () => 64],
      ['max (60-tick chunks)', () => 60],
      ['irregular', () => 1 + ((irregular = (irregular * 37 + 11) % 97))],
    ];
    for (const [label, budget] of pacings) {
      const run = await runPaced(budget);
      // Really paced: the batch was split across many frames.
      expect(run.frames, label).toBeGreaterThan(totalTicks / 100);
      expect(run.entries, label).toEqual(reference.entries);
      expect(run.hashes.size, label).toBe(reference.hashes.size);
      for (const [match, list] of reference.hashes) expect(run.hashes.get(match), `${label}, match ${match}`).toEqual(list);
    }
  }, 600_000);
});
