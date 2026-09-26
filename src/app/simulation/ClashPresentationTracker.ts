// ============================================================
// CLASH PRESENTATION TRACKER
// Pure, testable edge-detection for Milestone 5's presentation-facing
// events (telemetry + GameState transitions) — separated out of main.ts's
// per-tick closure specifically so this file's own self-tests can verify
// the GDD's lifecycle ordering directly: resolution -> knockback ->
// normal game state resumes, with the 10s Cooldown that follows being
// purely an internal restriction on starting a new Clash, never a
// presentation state of its own.
//
// ClashEnd fires (and GameState.Clash should end) the INSTANT a Clash
// resolves (Active -> Cooldown), not once Cooldown finishes elapsing
// (Cooldown -> Idle) — main.ts must not wait for the second edge.
// ============================================================

import { ClashState, type ClashResult } from '../../combat/clash/ClashController';

export interface ClashMashInputEdge {
  isFirst: boolean;
  mashEventCount: number;
}

export interface ClashPresentationEvents {
  /** Idle -> Active this update — fire ClashStart telemetry and enter GameState.Clash. */
  clashStarted: boolean;
  /** Set on the exact tick a Clash resolves (Active -> Cooldown) — fire ClashResult telemetry with this data. Non-null implies clashEnded is also true. */
  clashResult: ClashResult | null;
  /** Fires on the SAME update() call as clashResult, not on a later Cooldown -> Idle transition — fire ClashEnd telemetry and leave GameState.Clash (back to Combat, unless the round ended). */
  clashEnded: boolean;
  /** One entry per side whose running mash-event count increased this update — fire one ClashMashInput telemetry event per entry. */
  mashInputEvents: ClashMashInputEdge[];
}

export class ClashPresentationTracker {
  private previousState: ClashState = ClashState.Idle;
  private previousFirstMashEventCount = 0;
  private previousSecondMashEventCount = 0;

  /**
   * Call once per tick with the Clash's current live state/mash counts and
   * this tick's resolution result (if any, from MatchTickResult.clashResolvedThisTick —
   * already guarded by the caller against a hitstop-frozen tick reusing a
   * stale cached result, since this tracker has no way to know that on
   * its own).
   */
  update(currentState: ClashState, clashResolvedThisTick: ClashResult | null, currentFirstMashEventCount: number, currentSecondMashEventCount: number): ClashPresentationEvents {
    const events: ClashPresentationEvents = {
      clashStarted: this.previousState === ClashState.Idle && currentState === ClashState.Active,
      clashResult: clashResolvedThisTick,
      clashEnded: clashResolvedThisTick !== null,
      mashInputEvents: [],
    };

    if (currentFirstMashEventCount > this.previousFirstMashEventCount) {
      events.mashInputEvents.push({ isFirst: true, mashEventCount: currentFirstMashEventCount });
    }
    if (currentSecondMashEventCount > this.previousSecondMashEventCount) {
      events.mashInputEvents.push({ isFirst: false, mashEventCount: currentSecondMashEventCount });
    }

    this.previousState = currentState;
    this.previousFirstMashEventCount = currentFirstMashEventCount;
    this.previousSecondMashEventCount = currentSecondMashEventCount;
    return events;
  }
}
