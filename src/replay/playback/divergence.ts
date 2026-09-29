// ============================================================
// DIVERGENCE (M9 lane C — GDD 76)
// Two tools, both keyed by TicksCompleted (the contract's state counter):
//
// - compareCheckpoints(): a replay's stored checkpoints against the ones a
//   playback produced. It says whether they match, and if not, the window
//   the divergence lies in: after the last matching checkpoint, up to and
//   including the first mismatching one.
// - locateFirstDivergence(): steps two runs of the real runtime in lockstep
//   and hashes both every tick, so it names the exact first TicksCompleted
//   whose states differ, the TickIndex that produced it, and which fields
//   differ. Runs are deterministic, so re-running from the start is always
//   possible; a match is a few thousand ticks, so a linear scan is cheap and
//   needs no state snapshots.
// ============================================================

import { type StateCheckpoint, type StateHash, type TickIndex, type TicksCompleted } from '../contracts';
import type { CanonicalRecord } from '../state/CanonicalValue';
import { diffCanonical, stateHash } from '../state/stateHash';

export type CheckpointComparison =
  | { readonly status: 'match'; readonly compared: number }
  | {
      readonly status: 'diverged';
      readonly compared: number;
      /** The last checkpoint that matched, or null if the very first one differs. */
      readonly lastMatch: TicksCompleted | null;
      readonly firstMismatch: { readonly ticksCompleted: TicksCompleted; readonly expected: StateHash; readonly actual: StateHash };
    }
  | {
      /** The playback has no checkpoint for a TicksCompleted the replay expects (it stopped early). */
      readonly status: 'incomplete';
      readonly compared: number;
      readonly missing: TicksCompleted;
    };

/**
 * Compares every expected checkpoint, in TicksCompleted order, with the
 * actual one at the same TicksCompleted. Extra actual checkpoints are
 * ignored. Throws if either list has a TicksCompleted twice (a malformed
 * list, not a divergence).
 */
export function compareCheckpoints(expected: readonly StateCheckpoint[], actual: readonly StateCheckpoint[]): CheckpointComparison {
  const actualByTicks = indexCheckpoints(actual, 'actual');
  const ordered = [...indexCheckpoints(expected, 'expected').values()].sort((a, b) => a.ticksCompleted - b.ticksCompleted);
  let lastMatch: TicksCompleted | null = null;
  let compared = 0;
  for (const want of ordered) {
    const got = actualByTicks.get(want.ticksCompleted);
    if (got === undefined) return { status: 'incomplete', compared, missing: want.ticksCompleted };
    compared++;
    if (got.hash !== want.hash) {
      return { status: 'diverged', compared, lastMatch, firstMismatch: { ticksCompleted: want.ticksCompleted, expected: want.hash, actual: got.hash } };
    }
    lastMatch = want.ticksCompleted;
  }
  return { status: 'match', compared };
}

function indexCheckpoints(list: readonly StateCheckpoint[], name: string): Map<TicksCompleted, StateCheckpoint> {
  const map = new Map<TicksCompleted, StateCheckpoint>();
  for (const checkpoint of list) {
    if (map.has(checkpoint.ticksCompleted)) throw new Error(`compareCheckpoints: ${name} has two checkpoints at ticksCompleted ${checkpoint.ticksCompleted}.`);
    map.set(checkpoint.ticksCompleted, checkpoint);
  }
  return map;
}

/** One run of the real runtime, seen from outside: advance one tick, read the canonical state. */
export interface SteppableRun {
  /** Runs TickIndex = current TicksCompleted. */
  advance(): void;
  /** CanonicalMatchStateV1 at the current TicksCompleted. */
  canonicalState(): CanonicalRecord;
}

export type DivergenceReport =
  | { readonly status: 'identical'; readonly ticksCompared: TicksCompleted }
  | {
      readonly status: 'diverged';
      /** The first TicksCompleted whose states differ (0 = they differ before any tick). */
      readonly ticksCompleted: TicksCompleted;
      /** The tick that produced the first differing state; null when the initial states already differ. */
      readonly tickIndex: TickIndex | null;
      readonly hashA: StateHash;
      readonly hashB: StateHash;
      /** Canonical field paths that differ, e.g. `beys.first.body.linvel.x`. */
      readonly paths: readonly string[];
    };

/**
 * Steps `a` and `b` together for up to `ticks` ticks, comparing their
 * canonical states at TicksCompleted 0, 1, …, `ticks`, and stops at the
 * first difference. `from` lets a caller skip comparing a known-good
 * prefix (the runs are still advanced through it).
 */
export function locateFirstDivergence(a: SteppableRun, b: SteppableRun, ticks: number, from: TicksCompleted = 0): DivergenceReport {
  for (let done: TicksCompleted = 0; ; done++) {
    if (done >= from) {
      const stateA = a.canonicalState();
      const stateB = b.canonicalState();
      const hashA = stateHash(stateA);
      const hashB = stateHash(stateB);
      if (hashA !== hashB) {
        // TickIndex n produces TicksCompleted n + 1, so state `done` came from TickIndex done - 1.
        return { status: 'diverged', ticksCompleted: done, tickIndex: done === 0 ? null : done - 1, hashA, hashB, paths: diffCanonical(stateA, stateB) };
      }
    }
    if (done === ticks) return { status: 'identical', ticksCompared: ticks };
    a.advance();
    b.advance();
  }
}
