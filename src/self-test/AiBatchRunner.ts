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
import { NullAiMashSource } from '../combat/clash/ClashMash';
import { SelfTestMatchWorld } from './SelfTestMatchWorld';
import {
  DEFAULT_AI_MATCH_MAX_TICKS,
  DEFAULT_SLOW_TICK_THRESHOLD_MS,
  stepAiMatchOnWorld,
  type AiMatchRecord,
  type AiMatchSetup,
  type MatchAnomaly,
} from './AiMatchSimulation';
import type { DetectedAnomaly } from './anomalies/MatchAnomalyDetector';

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
  /** GDD 67 detector findings (invalid states and warnings), capped per match. */
  readonly detections: readonly DetectedAnomaly[];
  readonly invalidDetectionCount: number;
  readonly warningCount: number;
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
  /** GDD 67 detections across the batch, by kind (invalid states and warnings). */
  readonly anomalyKinds: Readonly<Record<string, number>>;
  /** Invalid-state detections matched to an already-recorded bug, by issue id (still failures). */
  readonly knownIssues: Readonly<Record<string, number>>;
  /** Matches failed as invalid state by anything NOT matched to a known issue — the number that should stay 0. */
  readonly unknownInvalidStates: number;
  /** Matches with detector warnings — reported, not failed. */
  readonly warnings: readonly { readonly seed: string; readonly matchup: string; readonly detections: readonly DetectedAnomaly[] }[];
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
  if (record.anomalyCount > 0 || record.invalidDetectionCount > 0) failureReasons.push('invalid-state');
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
    detections: record.detections,
    invalidDetectionCount: record.invalidDetectionCount,
    warningCount: record.warningCount,
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
    detections: [],
    invalidDetectionCount: 0,
    warningCount: 0,
    maxTickMs: 0,
    slowTicks: 0,
  };
}

function countAnomalyKinds(entries: readonly AiBatchMatchEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const anomaly of entry.anomalies) counts[anomaly.kind] = (counts[anomaly.kind] ?? 0) + 1;
    for (const detection of entry.detections) counts[detection.kind] = (counts[detection.kind] ?? 0) + 1;
  }
  return counts;
}

function countKnownIssues(entries: readonly AiBatchMatchEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const detection of entry.detections) {
      if (detection.knownIssue) counts[detection.knownIssue] = (counts[detection.knownIssue] ?? 0) + 1;
    }
  }
  return counts;
}

/** True when every invalid-state finding of a match is matched to a known issue (and nothing was cut off by the per-match cap). */
export function isOnlyKnownIssues(entry: AiBatchMatchEntry): boolean {
  if (entry.anomalyCount > 0) return false;
  const invalid = entry.detections.filter((d) => d.severity === 'invalid-state');
  return invalid.length === entry.invalidDetectionCount && invalid.every((d) => d.knownIssue !== null);
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
    anomalyKinds: countAnomalyKinds(entries),
    knownIssues: countKnownIssues(entries),
    unknownInvalidStates: count((e) => e.failureReasons.includes('invalid-state') && !isOnlyKnownIssues(e)),
    warnings: entries
      .filter((e) => e.warningCount > 0)
      .map((e) => ({ seed: e.seed, matchup: e.matchup, detections: e.detections.filter((d) => d.severity === 'warning') })),
    failures: entries.filter((e) => !e.passed),
    entries,
    timing: { wallMs, simulatedS, simulatedPerWallSecond: wallMs > 0 ? simulatedS / (wallMs / 1000) : 0, slowTickThresholdMs },
  };
}

interface BatchJob {
  readonly matchup: AiBatchMatchup;
  readonly label: string;
  readonly seed: string;
}

/** What the batch is doing right now — for a live view. */
export interface AiBatchProgress {
  readonly completed: number;
  readonly total: number;
  /** The match being simulated, or null between matches / when done. */
  readonly current: { readonly seed: string; readonly matchup: string; readonly tick: number; readonly world: SelfTestMatchWorld } | null;
}

/**
 * A batch that can be advanced a bounded number of fixed ticks at a time
 * (the browser Self Test steps it a few ticks per frame). runAiBatch() is
 * this session run to completion, so headless and in-browser batches are
 * the same code, match for match.
 */
export class AiBatchSession {
  private readonly jobs: BatchJob[] = [];
  private readonly entries: AiBatchMatchEntry[] = [];
  private readonly slowTickThresholdMs: number;
  private current: { job: BatchJob; world: SelfTestMatchWorld; steps: Generator<number, AiMatchRecord, void>; tick: number } | null = null;
  private busyMs = 0;

  constructor(private readonly config: AiBatchConfig) {
    this.slowTickThresholdMs = config.slowTickThresholdMs ?? DEFAULT_SLOW_TICK_THRESHOLD_MS;
    for (const matchup of config.matchups) {
      const label = matchupLabel(matchup);
      for (const baseSeed of config.seeds) this.jobs.push({ matchup, label, seed: `${baseSeed}/${label}` });
    }
  }

  get isDone(): boolean {
    return this.entries.length >= this.jobs.length;
  }

  progress(): AiBatchProgress {
    return {
      completed: this.entries.length,
      total: this.jobs.length,
      current: this.current ? { seed: this.current.job.seed, matchup: this.current.job.label, tick: this.current.tick, world: this.current.world } : null,
    };
  }

  /** Simulates up to `tickBudget` fixed ticks (across matches if one ends). Resolves true once every match is done. */
  async step(tickBudget: number): Promise<boolean> {
    const startedAtMs = performance.now();
    let budget = tickBudget;
    try {
      while (budget > 0 && !this.isDone) {
        if (!this.current) {
          const job = this.jobs[this.entries.length]!;
          try {
            const world = await SelfTestMatchWorld.build({
              firstSpawn: this.config.firstSpawn,
              secondSpawn: this.config.secondSpawn,
              aiMashSource: new NullAiMashSource(),
              firstDefinition: job.matchup.firstDefinition,
              secondDefinition: job.matchup.secondDefinition,
            });
            const steps = stepAiMatchOnWorld(
              world,
              {
                seed: job.seed,
                firstDefinition: job.matchup.firstDefinition,
                secondDefinition: job.matchup.secondDefinition,
                firstPersonality: job.matchup.firstPersonality,
                secondPersonality: job.matchup.secondPersonality,
                difficulty: this.config.difficulty,
                maxTicks: this.config.maxTicks ?? DEFAULT_AI_MATCH_MAX_TICKS,
                onTick: this.config.onTick,
              },
              this.slowTickThresholdMs,
            );
            this.current = { job, world, steps, tick: 0 };
          } catch (error) {
            this.finish(crashEntry(job.seed, job.label, error));
            continue;
          }
        }
        const run = this.current!;
        try {
          const next = run.steps.next();
          budget--;
          if (next.done) {
            this.finish(entryFromRecord(run.job.seed, run.job.label, next.value));
          } else {
            run.tick = next.value + 1;
          }
        } catch (error) {
          this.finish(crashEntry(run.job.seed, run.job.label, error));
        }
      }
    } finally {
      this.busyMs += performance.now() - startedAtMs;
    }
    return this.isDone;
  }

  /** The GDD 163 report over the matches finished so far. */
  report(): AiBatchReport {
    return summarizeAiBatch(this.entries, this.busyMs, this.slowTickThresholdMs);
  }

  /** Frees the world of a match in progress (when a run is abandoned). */
  dispose(): void {
    this.current?.world.dispose();
    this.current = null;
  }

  private finish(entry: AiBatchMatchEntry): void {
    this.current?.world.dispose();
    this.current = null;
    this.entries.push(entry);
    this.config.onMatchComplete?.(entry, this.entries.length - 1, this.jobs.length);
  }
}

/**
 * Runs the batch sequentially (one Rapier world at a time, freed after each
 * match). A match that throws is recorded as a crash and the batch goes on.
 */
export async function runAiBatch(config: AiBatchConfig): Promise<AiBatchReport> {
  const session = new AiBatchSession(config);
  await session.step(Number.POSITIVE_INFINITY);
  return session.report();
}
