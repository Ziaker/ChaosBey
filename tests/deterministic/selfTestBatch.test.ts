// ============================================================
// SELF-TEST CORE + BATCH RUNNER (M8)
// The runtime self-test core (src/self-test/) runs real AI-vs-AI matches
// headless and reports them the way GDD section 163 asks. These checks
// cover the report's contract: every field filled from real matches,
// reproducible seeds, failures (crash, invalid state, hang) captured with
// their seed preserved, divergence counted by replaying every match (M9) or
// reported as not checked (never 0), and matches simulated faster than
// real time (GDD 164).
// ============================================================

import { describe, expect, it } from 'vitest';
import { FIRST_SPAWN, SECOND_SPAWN } from '../../src/app/bootstrap/matchSpawns';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { DIVERGENCE_NOT_CHECKED, runAiBatch, summarizeAiBatch, type AiBatchConfig, type AiBatchMatchEntry } from '../../src/self-test/AiBatchRunner';
import { SelfTestMatchWorld } from '../../src/self-test/SelfTestMatchWorld';

const MATCHUPS: AiBatchConfig['matchups'] = [
  { firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE },
  { firstDefinition: STAMINA_ARCHETYPE, secondDefinition: ATTACK_ARCHETYPE },
];
const SEEDS = ['self-test-0', 'self-test-1'];

describe('SelfTestMatchWorld', () => {
  it('builds the real match with the live game spawns by default', async () => {
    const world = await SelfTestMatchWorld.build({ firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE });
    try {
      expect(world.first.body.translation()).toMatchObject({ x: FIRST_SPAWN.x, z: FIRST_SPAWN.z });
      expect(world.second.body.translation()).toMatchObject({ x: SECOND_SPAWN.x, z: SECOND_SPAWN.z });
      expect(world.first.definition.id).toBe(ATTACK_ARCHETYPE.id);
      expect(world.roundState.result).toBe(RoundOutcome.Ongoing);
    } finally {
      world.dispose();
    }
  });
});

describe('runAiBatch — real matches', () => {
  it('fills every GDD 163 field from real matches and runs faster than real time', async () => {
    const report = await runAiBatch({ matchups: MATCHUPS, seeds: SEEDS });

    expect(report.matches).toBe(MATCHUPS.length * SEEDS.length);
    expect(report.passed + report.failed).toBe(report.matches);
    expect(report.seeds).toHaveLength(report.matches);
    expect(report.seeds).toContain('self-test-0/attack-prototype-vs-defense-prototype');
    expect(report.crashes).toBe(0);
    // The GDD 67 detector reports the recorded ext-32 wall-collider bug as an
    // invalid state (it must not be hidden); what must stay at 0 is any
    // invalid state NOT matched to a known issue.
    expect(report.unknownInvalidStates).toBe(0);
    expect(report.invalidStates).toBe(report.failures.filter((e) => e.failureReasons.includes('invalid-state')).length);
    const { ringOuts, kos, draws, unresolved } = report.outcomes;
    expect(ringOuts + kos + draws + unresolved).toBe(report.matches);
    expect(report.averageDurationS).toBeGreaterThan(0);
    expect(report.clashCount).toBeGreaterThanOrEqual(0);
    expect(report.failures).toHaveLength(report.failed);
    // Headless, the simulation runs as fast as the CPU allows (GDD 164).
    expect(report.timing.simulatedPerWallSecond).toBeGreaterThan(1);
  }, 120_000);

  it('never claims zero divergences without checking: an unverified batch says "not checked"', async () => {
    const report = await runAiBatch({ matchups: MATCHUPS.slice(0, 1), seeds: SEEDS.slice(0, 1), maxTicks: 60 });
    expect(report.divergence).toEqual(DIVERGENCE_NOT_CHECKED);
    expect(report.divergence.count).toBeNull();
    expect(report.entries.every((e) => e.replayCheck === null)).toBe(true);
  });

  it('with replay verification, every match is replayed from its own recording and the divergences counted (M9)', async () => {
    const plain = await runAiBatch({ matchups: MATCHUPS, seeds: SEEDS, maxTicks: 900 });
    const verified = await runAiBatch({ matchups: MATCHUPS, seeds: SEEDS, maxTicks: 900, verifyReplays: true });
    expect(verified.divergence).toMatchObject({ status: 'checked', count: 0, checked: verified.matches, diverged: [] });
    for (const entry of verified.entries) {
      expect(entry.replayCheck?.status, entry.seed).toBe('verified');
      expect(entry.replayCheck?.detail).toMatch(new RegExp(`^${entry.ticks} ticks, ${entry.ticks + 1} checkpoints identical$`));
    }
    // Recording and replaying change nothing about the matches themselves.
    const strip = (e: AiBatchMatchEntry) => ({ seed: e.seed, outcome: e.outcome, ticks: e.ticks, clashes: e.clashes, passed: e.passed });
    expect(verified.entries.map(strip)).toEqual(plain.entries.map(strip));
  }, 300_000);

  it('a state edit during a match (outside the inputs) is counted as a divergence and fails the match, at the right tick', async () => {
    const editAt = 40;
    const report = await runAiBatch({
      matchups: MATCHUPS.slice(0, 1),
      seeds: ['divergence-injection'],
      maxTicks: 300,
      verifyReplays: true,
      // After tick `editAt` was recorded, nudge a Bey: not an input, so the replay can't reproduce it.
      onTick: (tick, world) => {
        if (tick !== editAt) return;
        const v = world.first.body.linvel();
        world.first.body.setLinvel({ x: v.x + 0.5, y: v.y, z: v.z }, true);
      },
    });
    const entry = report.entries[0]!;
    expect(entry.ticks).toBeGreaterThan(editAt + 1);
    expect(entry.replayCheck).toMatchObject({ status: 'diverged', firstMismatch: editAt + 2 });
    expect(entry.failureReasons).toContain('divergence');
    expect(entry.passed).toBe(false);
    expect(report.divergence).toMatchObject({ status: 'checked', count: 1, checked: 1 });
  }, 60_000);

  it('is reproducible: the same config gives the same matches, seed for seed', async () => {
    const a = await runAiBatch({ matchups: MATCHUPS, seeds: SEEDS });
    const b = await runAiBatch({ matchups: MATCHUPS, seeds: SEEDS });
    const shape = (e: AiBatchMatchEntry) => ({ seed: e.seed, outcome: e.outcome, ticks: e.ticks, clashes: e.clashes, passed: e.passed });
    expect(b.entries.map(shape)).toEqual(a.entries.map(shape));
  }, 240_000);
});

describe('runAiBatch — failures are captured with their seed preserved', () => {
  it('records a crash, keeps its seed, and still runs the rest of the batch', async () => {
    const crashingSeed = 'self-test-1/attack-prototype-vs-defense-prototype';
    const perSeed = await runAiBatch({
      matchups: MATCHUPS.slice(0, 1),
      seeds: SEEDS,
      maxTicks: 120,
      onTick: faultOnSecondMatch(),
    });
    expect(perSeed.matches).toBe(2);
    expect(perSeed.crashes).toBe(1);
    const crash = perSeed.failures.find((e) => e.failureReasons.includes('crash'));
    expect(crash?.seed).toBe(crashingSeed);
    expect(crash?.crashMessage).toContain('injected fault');
    expect(crash?.outcome).toBeNull();
    // The other match still ran to its tick budget.
    expect(perSeed.entries[0]!.crashMessage).toBeNull();
    expect(perSeed.entries[0]!.ticks).toBeGreaterThan(0);
  }, 60_000);

  it('flags a NaN position as an invalid state from the tick it appears, and keeps the seed', async () => {
    const report = await runAiBatch({
      matchups: MATCHUPS.slice(0, 1),
      seeds: ['self-test-nan'],
      maxTicks: 120,
      onTick: (tick, world) => {
        if (tick === 5) world.first.body.setTranslation({ x: Number.NaN, y: 1, z: 0 }, true);
      },
    });
    expect(report.invalidStates).toBe(1);
    const failure = report.failures[0]!;
    expect(failure.seed).toBe('self-test-nan/attack-prototype-vs-defense-prototype');
    expect(failure.failureReasons).toContain('invalid-state');
    expect(failure.anomalies[0]).toMatchObject({ kind: 'non-finite-value', side: 'first' });
    expect(failure.anomalies[0]!.tick).toBeGreaterThanOrEqual(5);
    expect(failure.anomalyCount).toBeGreaterThanOrEqual(failure.anomalies.length);
    expect(failure.anomalies.length).toBeLessThanOrEqual(20);
  }, 60_000);

  it('reports a round that never ends within maxTicks as a hang (unresolved), with its seed', async () => {
    const report = await runAiBatch({ matchups: MATCHUPS.slice(0, 1), seeds: SEEDS, maxTicks: 30 });
    expect(report.hangs).toBe(2);
    expect(report.outcomes.unresolved).toBe(2);
    expect(report.failures.map((e) => e.seed)).toEqual(report.seeds);
    for (const failure of report.failures) {
      expect(failure.failureReasons).toEqual(['hang']);
      expect(failure.ticks).toBe(30);
    }
  });
});

describe('summarizeAiBatch', () => {
  const entry = (over: Partial<AiBatchMatchEntry>): AiBatchMatchEntry => ({
    seed: 's',
    matchup: 'm',
    passed: true,
    failureReasons: [],
    outcome: RoundOutcome.FirstWinsByKo,
    ticks: 600,
    clashes: 1,
    crashMessage: null,
    anomalies: [],
    anomalyCount: 0,
    detections: [],
    invalidDetectionCount: 0,
    warningCount: 0,
    maxTickMs: 1,
    slowTicks: 0,
    replayCheck: null,
    ...over,
  });

  it('counts outcomes, leaves crashed matches out of the average duration, and lists slow matches as performance anomalies', () => {
    const report = summarizeAiBatch(
      [
        entry({ seed: 'a', outcome: RoundOutcome.FirstWinsByKo, ticks: 600 }),
        entry({ seed: 'b', outcome: RoundOutcome.SecondWinsByRingOut, ticks: 1200, clashes: 2, slowTicks: 3, maxTickMs: 40 }),
        entry({ seed: 'c', outcome: null, ticks: 0, clashes: 0, passed: false, failureReasons: ['crash'], crashMessage: 'Error: x' }),
      ],
      1000,
      16,
    );
    expect(report.matches).toBe(3);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.crashes).toBe(1);
    expect(report.outcomes).toEqual({ ringOuts: 1, kos: 1, draws: 0, unresolved: 0 });
    expect(report.clashCount).toBe(3);
    expect(report.averageDurationS).toBeCloseTo(15, 5); // (10 s + 20 s) / 2 finished matches
    expect(report.performanceAnomalies).toEqual([{ seed: 'b', matchup: 'm', slowTicks: 3, maxTickMs: 40 }]);
    expect(report.failures.map((e) => e.seed)).toEqual(['c']);
    expect(report.timing.simulatedS).toBeCloseTo(30, 5);
    expect(report.timing.simulatedPerWallSecond).toBeCloseTo(30, 5);
  });
});

/** Throws on the second match's tick 10 only: a fault the batch must record and survive. */
function faultOnSecondMatch(): NonNullable<AiBatchConfig['onTick']> {
  let matchIndex = -1;
  return (tick) => {
    if (tick === 0) matchIndex++;
    if (matchIndex === 1 && tick === 10) throw new Error('injected fault');
  };
}
