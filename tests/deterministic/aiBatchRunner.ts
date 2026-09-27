// ============================================================
// AI VS AI BATCH ORCHESTRATOR (MILESTONE 8A1)
// A thin scheduling layer over runAiMatch (aiMatchRunner.ts): run N seeds
// across N matchups, collect every match's stats, and flatten the physics
// anomalies each match already detects (see AiMatchStats.anomalies) into one
// reproducible failure list — seed + tick + side + kind + detail, enough to
// replay exactly which run went wrong. runAiMatch itself is untouched: it
// already runs headless as fast as the CPU allows (no wall-clock/render
// wait), so this file is orchestration only, not a new execution engine.
// ============================================================

import type { AiPersonality } from '../../src/ai/personalities/AiPersonality';
import type { AiDifficultyProfile } from '../../src/ai/difficulty/AiDifficultyProfile';
import type { BeyDefinition } from '../../src/bey/archetype/BeyDefinition';
import { runAiMatch, type AiMatchSetup, type AiMatchStats } from './aiMatchRunner';

export interface AiBatchMatchup {
  /** Human-readable label carried into every result/failure row (e.g. "attack-prototype vs defense-prototype"). */
  label: string;
  firstDefinition: BeyDefinition;
  secondDefinition: BeyDefinition;
  firstPersonality?: AiPersonality;
  secondPersonality?: AiPersonality;
  difficulty?: AiDifficultyProfile;
}

export interface AiBatchConfig {
  seeds: readonly string[];
  matchups: readonly AiBatchMatchup[];
  maxTicks?: number;
  /** Called once per completed match: (matches completed so far, total scheduled). */
  onProgress?: (completed: number, total: number) => void;
  /** Passed through to every runAiMatch call. Test-only hook for injecting a mid-match fault (see aiBatchRunner.test.ts); production batches have no reason to set this. */
  onTick?: AiMatchSetup['onTick'];
}

export interface AiBatchRunResult {
  matchupLabel: string;
  seed: string;
  stats: AiMatchStats;
}

export interface AiBatchFailure {
  matchupLabel: string;
  seed: string;
  tick: number;
  side: 'first' | 'second';
  kind: string;
  detail: string;
}

export interface AiBatchReport {
  totalMatches: number;
  totalTicks: number;
  wallClockMs: number;
  results: AiBatchRunResult[];
  /** Every physics anomaly across the whole batch, flattened out of each match's own AiMatchStats.anomalies. Empty in the overwhelming common case. */
  failures: AiBatchFailure[];
}

/** Runs every (matchup × seed) combination in `config` through runAiMatch, sequentially, and aggregates the results into one report. */
export async function runAiBatch(config: AiBatchConfig): Promise<AiBatchReport> {
  const total = config.seeds.length * config.matchups.length;
  const results: AiBatchRunResult[] = [];
  const failures: AiBatchFailure[] = [];
  const startedAt = Date.now();
  let completed = 0;
  let totalTicks = 0;

  for (const matchup of config.matchups) {
    for (const seed of config.seeds) {
      const stats = await runAiMatch({
        seed,
        firstDefinition: matchup.firstDefinition,
        secondDefinition: matchup.secondDefinition,
        firstPersonality: matchup.firstPersonality,
        secondPersonality: matchup.secondPersonality,
        difficulty: matchup.difficulty,
        maxTicks: config.maxTicks,
        onTick: config.onTick,
      });
      results.push({ matchupLabel: matchup.label, seed, stats });
      totalTicks += stats.ticks;
      for (const anomaly of stats.anomalies) {
        failures.push({ matchupLabel: matchup.label, seed, tick: anomaly.tick, side: anomaly.side, kind: anomaly.kind, detail: anomaly.detail });
      }
      completed++;
      config.onProgress?.(completed, total);
    }
  }

  return { totalMatches: results.length, totalTicks, wallClockMs: Date.now() - startedAt, results, failures };
}
