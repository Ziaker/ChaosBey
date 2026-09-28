// ============================================================
// AI VS AI BATCH RUNNER — SELF-TEST CORE (M8)
// Runs every (matchup × seed) pair through simulateAiMatch() — the real
// match, headless, as fast as the CPU allows (GDD 114/164) — and returns
// the batch report GDD section 163 asks for: matches, pass/fail, seeds,
// crashes, hangs, invalid states, average duration, ring-outs, KOs, Clash
// count, divergence count and performance anomalies, with every failing
// match's seed preserved so it can be replayed exactly (GDD 163: "When a
// match fails, preserve its seed/replay").
//
// Runtime code with no test framework in it: the deterministic suite, a
// future Debug Lab / Self Test screen and any script share it.
// ============================================================

import type { AiDifficultyProfile } from '../ai/difficulty/AiDifficultyProfile';
import type { AiPersonality } from '../ai/personalities/AiPersonality';
import type { SpawnPositionM } from '../app/bootstrap/matchSpawns';
import type { BeyDefinition } from '../bey/archetype/BeyDefinition';
import { RoundOutcome } from '../combat/round-rules/RoundState';
import { FIXED_DELTA_SECONDS } from '../physics/fixed-step/FixedTimestepLoop';
import {
  DEFAULT_AI_MATCH_MAX_TICKS,
  DEFAULT_SLOW_TICK_THRESHOLD_MS,
  simulateAiMatch,
  type AiMatchRecord,
  type AiMatchSetup,
  type MatchAnomaly,
} from './AiMatchSimulation';

export interface AiBatchMatchup {
  readonly firstDefinition: BeyDefinition;
  readonly secondDefinition: BeyDefinition;
  /** Default to each archetype's own personality, as main.ts resolves it. */
  readonly firstPersonality?: AiPersonality;
  readonly secondPersonality?: AiPersonality;
}

export interface AiBatchConfig {
  readonly matchups: readonly AiBatchMatchup[];
  /** Every matchup plays every seed. The match seed is `${seed}/${first.id}-vs-${second.id}`. */
  readonly seeds: readonly string[];
  readonly maxTicks?: number;
  readonly difficulty?: AiDifficultyProfile;
  /** Omit for the live game's spawns. */
  readonly firstSpawn?: SpawnPositionM;
  readonly secondSpawn?: SpawnPositionM;
  /** A tick slower than this counts toward performance anomalies. Default: one 60 fps frame. */
  readonly slowTickThresholdMs?: number;
  /** Per-tick hook passed to every match (diagnostics, or fault injection in tests). */
  readonly onTick?: AiMatchSetup['onTick'];
  /** Called after each match, for progress reporting. */
  readonly onMatchComplete?: (entry: AiBatchMatchEntry, index: number, total: number) => void;
}

/** Why a match failed. `hang` = the round did not end within `maxTicks`. */
export type AiBatchFailureReason = 'crash' | 'invalid-state' | 'hang';

export interface AiBatchMatchEntry {
  /** The exact seed simulateAiMatch() used: replaying it reproduces the match. */
  readonly seed: string;
  readonly matchup: string;
  readonly passed: boolean;
  readonly failureReasons: readonly AiBatchFailureReason[];
  /** Null when the match crashed before finishing. */
  readonly outcome: RoundOutcome | null;
  readonly ticks: number;
  readonly clashes: number;
  readonly crashMessage: string | null;
  readonly anomalies: readonly MatchAnomaly[];
  readonly anomalyCount: number;
  readonly maxTickMs: number;
  readonly slowTicks: number;
}

/**
 * Replay divergence needs state hashes and replay playback, which arrive
 * with Milestone 9 (GDD section 145). Until then the report says so
 * explicitly instead of claiming zero divergences.
 */
export interface UnsupportedDivergence {
  readonly status: 'unsupported';
  readonly count: null;
  readonly reason: string;
}

export const DIVERGENCE_UNSUPPORTED_UNTIL_M9: UnsupportedDivergence = {
  status: 'unsupported',
  count: null,
  reason: 'Divergence detection needs state hashes and replay playback, which arrive with Milestone 9 (GDD section 145).',
};

export interface AiBatchReport {
  readonly matches: number;
  readonly passed: number;
  readonly failed: number;
  /** Every match seed, in run order. */
  readonly seeds: readonly string[];
  readonly crashes: number;
  readonly hangs: number;
  readonly invalidStates: number;
  /** Mean simulated round length (s) over matches that finished without crashing. */
  readonly averageDurationS: number;
  readonly outcomes: {
    readonly ringOuts: number;
    readonly kos: number;
    readonly draws: number;
    /** Rounds still Ongoing at `maxTicks` (the hangs). */
    readonly unresolved: number;
  };
  readonly clashCount: number;
  readonly divergence: UnsupportedDivergence;
  /** Matches with at least one tick slower than the threshold. Diagnostic, not a failure. */
  readonly performanceAnomalies: readonly { readonly seed: string; readonly matchup: string; readonly slowTicks: number; readonly maxTickMs: number }[];
  /** Every failing match, with its seed preserved for exact replay. */
  readonly failures: readonly AiBatchMatchEntry[];
  readonly entries: readonly AiBatchMatchEntry[];
  /** Acceleration evidence: simulated seconds per wall second over the whole batch. */
  readonly timing: { readonly wallMs: number; readonly simulatedS: number; readonly simulatedPerWallSecond: number; readonly slowTickThresholdMs: number };
}

export function matchupLabel(matchup: AiBatchMatchup): string {
  return `${matchup.firstDefinition.id}-vs-${matchup.secondDefinition.id}`;
}

function isRingOut(outcome: RoundOutcome): boolean {
  return outcome === RoundOutcome.FirstWinsByRingOut || outcome === RoundOutcome.SecondWinsByRingOut;
}

function isKo(outcome: RoundOutcome): boolean {
  return outcome === RoundOutcome.FirstWinsByKo || outcome === RoundOutcome.SecondWinsByKo;
}

function entryFromRecord(seed: string, matchup: string, record: AiMatchRecord): AiBatchMatchEntry {
  const failureReasons: AiBatchFailureReason[] = [];
  if (record.anomalyCount > 0) failureReasons.push('invalid-state');
  if (record.stats.outcome === RoundOutcome.Ongoing) failureReasons.push('hang');
  return {
    seed,
    matchup,
    passed: failureReasons.length === 0,
    failureReasons,
    outcome: record.stats.outcome,
    ticks: record.stats.ticks,
    clashes: record.stats.clashes,
    crashMessage: null,
    anomalies: record.anomalies,
    anomalyCount: record.anomalyCount,
    maxTickMs: record.timing.maxTickMs,
    slowTicks: record.timing.slowTicks,
  };
}

function crashEntry(seed: string, matchup: string, error: unknown): AiBatchMatchEntry {
  return {
    seed,
    matchup,
    passed: false,
    failureReasons: ['crash'],
    outcome: null,
    ticks: 0,
    clashes: 0,
    crashMessage: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    anomalies: [],
    anomalyCount: 0,
    maxTickMs: 0,
    slowTicks: 0,
  };
}

/** Summarizes finished entries into the GDD 163 report. Pure: the same entries always give the same report. */
export function summarizeAiBatch(entries: readonly AiBatchMatchEntry[], wallMs: number, slowTickThresholdMs: number): AiBatchReport {
  const finished = entries.filter((e) => e.outcome !== null);
  const simulatedS = entries.reduce((sum, e) => sum + e.ticks * FIXED_DELTA_SECONDS, 0);
  const count = (predicate: (e: AiBatchMatchEntry) => boolean) => entries.filter(predicate).length;
  return {
    matches: entries.length,
    passed: count((e) => e.passed),
    failed: count((e) => !e.passed),
    seeds: entries.map((e) => e.seed),
    crashes: count((e) => e.failureReasons.includes('crash')),
    hangs: count((e) => e.failureReasons.includes('hang')),
    invalidStates: count((e) => e.failureReasons.includes('invalid-state')),
    averageDurationS: finished.length === 0 ? 0 : finished.reduce((sum, e) => sum + e.ticks * FIXED_DELTA_SECONDS, 0) / finished.length,
    outcomes: {
      ringOuts: count((e) => e.outcome !== null && isRingOut(e.outcome)),
      kos: count((e) => e.outcome !== null && isKo(e.outcome)),
      draws: count((e) => e.outcome === RoundOutcome.Draw),
      unresolved: count((e) => e.outcome === RoundOutcome.Ongoing),
    },
    clashCount: entries.reduce((sum, e) => sum + e.clashes, 0),
    divergence: DIVERGENCE_UNSUPPORTED_UNTIL_M9,
    performanceAnomalies: entries.filter((e) => e.slowTicks > 0).map((e) => ({ seed: e.seed, matchup: e.matchup, slowTicks: e.slowTicks, maxTickMs: e.maxTickMs })),
    failures: entries.filter((e) => !e.passed),
    entries,
    timing: { wallMs, simulatedS, simulatedPerWallSecond: wallMs > 0 ? simulatedS / (wallMs / 1000) : 0, slowTickThresholdMs },
  };
}

/**
 * Runs the batch sequentially (one Rapier world at a time, freed after each
 * match). A match that throws is recorded as a crash and the batch goes on.
 */
export async function runAiBatch(config: AiBatchConfig): Promise<AiBatchReport> {
  const slowTickThresholdMs = config.slowTickThresholdMs ?? DEFAULT_SLOW_TICK_THRESHOLD_MS;
  const total = config.matchups.length * config.seeds.length;
  const entries: AiBatchMatchEntry[] = [];
  const startedAtMs = performance.now();
  for (const matchup of config.matchups) {
    const label = matchupLabel(matchup);
    for (const baseSeed of config.seeds) {
      const seed = `${baseSeed}/${label}`;
      let entry: AiBatchMatchEntry;
      try {
        const record = await simulateAiMatch({
          seed,
          firstDefinition: matchup.firstDefinition,
          secondDefinition: matchup.secondDefinition,
          firstPersonality: matchup.firstPersonality,
          secondPersonality: matchup.secondPersonality,
          difficulty: config.difficulty,
          maxTicks: config.maxTicks ?? DEFAULT_AI_MATCH_MAX_TICKS,
          firstSpawn: config.firstSpawn,
          secondSpawn: config.secondSpawn,
          onTick: config.onTick,
          slowTickThresholdMs,
        });
        entry = entryFromRecord(seed, label, record);
      } catch (error) {
        entry = crashEntry(seed, label, error);
      }
      entries.push(entry);
      config.onMatchComplete?.(entry, entries.length - 1, total);
    }
  }
  return summarizeAiBatch(entries, performance.now() - startedAtMs, slowTickThresholdMs);
}
