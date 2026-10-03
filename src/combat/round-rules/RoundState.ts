// ============================================================
// ROUND STATE — MINIMAL ROUND FLOW (MILESTONE 2 FOUNDATION)
// Win-condition detection and round-end state only. Best-of-3 match
// structure, presentation and rule configuration are Milestone 10
// (pregame/presentation) — this just answers "is the round over, and how".
//
// Draws are allowed and there is no hidden tiebreaker: resolveTick()
// takes every KO/ring-out that happened during a single tick at once, so a
// genuinely simultaneous double-KO or double-ring-out is never decided by
// which side's event happened to be checked first — it resolves to Draw.
// ============================================================

import type { CanonicalRecord } from '../../replay/state/CanonicalValue';

export enum RoundOutcome {
  Ongoing = 'Ongoing',
  FirstWinsByKo = 'FirstWinsByKo',
  SecondWinsByKo = 'SecondWinsByKo',
  FirstWinsByRingOut = 'FirstWinsByRingOut',
  SecondWinsByRingOut = 'SecondWinsByRingOut',
  Draw = 'Draw',
}

export interface TickRoundEvents {
  /** A qualifying hit landed on first/second while already Broken (GDD section 29 Stability Break model), this tick. */
  firstKoed: boolean;
  secondKoed: boolean;
  firstRingOut: boolean;
  secondRingOut: boolean;
}

export interface RoundStateOptions {
  /**
   * Seconds a Bey must stay outside the ring-out radius before it counts (MatchConfig.ringOutDelayS); 0 = instant.
   * Omitted = 0, the pre-2026-10-02 instant rule: the game's 1.5 s default lives in MatchConfig, which every match
   * (MatchSession, SelfTestMatchWorld) passes in; bare RoundStates (unit tests, the Camera Lab prototype) keep the old rule.
   */
  readonly ringOutDelayS?: number;
}

export class RoundState {
  private outcome = RoundOutcome.Ongoing;
  private readonly ringOutDelayS: number;
  /** Continuous time (s) each Bey has spent outside the ring-out radius; back inside resets it. */
  private outsideS = { first: 0, second: 0 };

  constructor(options: RoundStateOptions = {}) {
    this.ringOutDelayS = Math.max(0, options.ringOutDelayS ?? 0);
  }

  /**
   * Feeds this tick's "outside the ring-out radius" for each Bey and returns which ones now count as ringed out:
   * outside continuously for at least the delay (owner, 2026-10-02). With a 0 delay, outside = ringed out at once.
   */
  trackRingOut(firstOutside: boolean, secondOutside: boolean, fixedDeltaSeconds: number): { readonly first: boolean; readonly second: boolean } {
    this.outsideS.first = firstOutside ? this.outsideS.first + fixedDeltaSeconds : 0;
    this.outsideS.second = secondOutside ? this.outsideS.second + fixedDeltaSeconds : 0;
    // A 1e-9 s tolerance so a delay that is a whole number of ticks is reached on that tick, not one later.
    const reached = (s: number, outside: boolean): boolean => outside && (this.ringOutDelayS === 0 || s >= this.ringOutDelayS - 1e-9);
    return { first: reached(this.outsideS.first, firstOutside), second: reached(this.outsideS.second, secondOutside) };
  }

  /** Seconds each Bey has been outside the ring-out radius (for the HUD/presentation; 0 when inside). */
  get ringOutClock(): { readonly first: number; readonly second: number } {
    return { first: this.outsideS.first, second: this.outsideS.second };
  }

  get isOver(): boolean {
    return this.outcome !== RoundOutcome.Ongoing;
  }

  get result(): RoundOutcome {
    return this.outcome;
  }

  /** Resolves every KO/ring-out from a single tick together — call this once per tick with everything that happened, never per-event. */
  resolveTick(events: TickRoundEvents): void {
    if (this.isOver) return;

    const firstLost = events.firstKoed || events.firstRingOut;
    const secondLost = events.secondKoed || events.secondRingOut;

    if (firstLost && secondLost) {
      this.outcome = RoundOutcome.Draw;
    } else if (secondLost) {
      this.outcome = events.secondKoed ? RoundOutcome.FirstWinsByKo : RoundOutcome.FirstWinsByRingOut;
    } else if (firstLost) {
      this.outcome = events.firstKoed ? RoundOutcome.SecondWinsByKo : RoundOutcome.SecondWinsByRingOut;
    }
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
  getDeterministicState(): CanonicalRecord {
    return { outcome: this.outcome, outsideS: { first: this.outsideS.first, second: this.outsideS.second } };
  }
}
