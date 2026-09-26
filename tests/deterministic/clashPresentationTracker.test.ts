// ============================================================
// CLASH PRESENTATION TRACKER SELF-TESTS
// Proves the GDD lifecycle ordering main.ts depends on: resolution ->
// knockback -> normal game state resumes immediately; the 10s Cooldown
// that follows is never its own presentation state, and ClashEnd is never
// delayed until Cooldown -> Idle.
// ============================================================

import { describe, expect, it } from 'vitest';
import { ClashPresentationTracker } from '../../src/app/simulation/ClashPresentationTracker';
import { ClashOutcome, ClashState, type ClashResult } from '../../src/combat/clash/ClashController';

const SAMPLE_RESULT: ClashResult = {
  outcome: ClashOutcome.FirstWins,
  firstClashPower: 0.8,
  secondClashPower: 0.4,
  firstMashEventCount: 12,
  secondMashEventCount: 6,
};

describe('ClashPresentationTracker', () => {
  it('fires clashStarted exactly on the Idle -> Active edge, never again while Active continues', () => {
    const tracker = new ClashPresentationTracker();
    expect(tracker.update(ClashState.Idle, null, 0, 0).clashStarted).toBe(false);
    expect(tracker.update(ClashState.Active, null, 0, 0).clashStarted).toBe(true);
    expect(tracker.update(ClashState.Active, null, 1, 0).clashStarted).toBe(false);
    expect(tracker.update(ClashState.Active, null, 2, 0).clashStarted).toBe(false);
  });

  it('clashResult and clashEnded fire on the SAME update as the resolution — while the state is already Cooldown, not Idle', () => {
    const tracker = new ClashPresentationTracker();
    tracker.update(ClashState.Idle, null, 0, 0);
    tracker.update(ClashState.Active, null, 3, 1);

    const resolutionEvents = tracker.update(ClashState.Cooldown, SAMPLE_RESULT, 3, 1);
    expect(resolutionEvents.clashResult).toBe(SAMPLE_RESULT);
    expect(resolutionEvents.clashEnded).toBe(true);
  });

  it('clashEnded does NOT wait for Cooldown -> Idle — it stays false on every later Cooldown tick, and never re-fires once Idle is actually reached', () => {
    const tracker = new ClashPresentationTracker();
    tracker.update(ClashState.Idle, null, 0, 0);
    tracker.update(ClashState.Active, null, 3, 1);
    tracker.update(ClashState.Cooldown, SAMPLE_RESULT, 3, 1); // the one genuine resolution edge.

    // Many ticks of Cooldown continuing, with no new resolution — this is
    // the exact scenario that used to (incorrectly) keep GameState.Clash
    // alive for the full 10s; clashEnded must never fire again here.
    for (let i = 0; i < 500; i++) {
      const events = tracker.update(ClashState.Cooldown, null, 3, 1);
      expect(events.clashEnded).toBe(false);
      expect(events.clashResult).toBeNull();
    }

    // Cooldown -> Idle (the OLD, no-longer-authoritative edge) fires nothing at all.
    const idleAgainEvents = tracker.update(ClashState.Idle, null, 3, 1);
    expect(idleAgainEvents.clashEnded).toBe(false);
    expect(idleAgainEvents.clashStarted).toBe(false);
  });

  it('reports one mashInputEvents entry per side whose running count increased this update, and none when nothing changed', () => {
    const tracker = new ClashPresentationTracker();
    const first = tracker.update(ClashState.Active, null, 1, 0);
    expect(first.mashInputEvents).toEqual([{ isFirst: true, mashEventCount: 1 }]);

    const both = tracker.update(ClashState.Active, null, 2, 1);
    expect(both.mashInputEvents).toEqual(
      expect.arrayContaining([
        { isFirst: true, mashEventCount: 2 },
        { isFirst: false, mashEventCount: 1 },
      ]),
    );
    expect(both.mashInputEvents).toHaveLength(2);

    const unchanged = tracker.update(ClashState.Active, null, 2, 1);
    expect(unchanged.mashInputEvents).toHaveLength(0);
  });

  it('a mash count reset to 0 (a fresh Clash starting) is not itself reported as a mash-input edge', () => {
    const tracker = new ClashPresentationTracker();
    tracker.update(ClashState.Active, null, 10, 5);
    // Resolution + a brand new Clash starting immediately after would reset counts to 0 — never an "increase".
    const resetEvents = tracker.update(ClashState.Active, null, 0, 0);
    expect(resetEvents.mashInputEvents).toHaveLength(0);
  });
});
