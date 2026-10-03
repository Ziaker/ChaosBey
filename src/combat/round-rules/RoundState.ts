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
  /** Owner, 2026-10-02 (Lote 5): the opponent's Stamina reached 0 — it stopped spinning. */
  FirstWinsBySpinOut = 'FirstWinsBySpinOut',
  SecondWinsBySpinOut = 'SecondWinsBySpinOut',
  Draw = 'Draw',
}

export interface TickRoundEvents {
  /** A qualifying hit landed on first/second while already Broken (GDD section 29 Stability Break model), this tick. */
  firstKoed: boolean;
  secondKoed: boolean;
  firstRingOut: boolean;
  secondRingOut: boolean;
  /** Owner, 2026-10-02: Stamina at 0 this tick — the Bey stopped spinning (spin-out). Omitted = false. */
  firstSpunOut?: boolean;
  secondSpunOut?: boolean;
}

export interface RoundStateOptions {
  /**
   * Seconds a Bey must stay outside the ring-out radius before it counts (MatchConfig.ringOutDelayS); 0 = instant.
   * Omitted = 0, the pre-2026-10-02 instant rule: the game's 1.5 s default lives in MatchConfig, which every match
   * (MatchSession, SelfTestMatchWorld) passes in; bare RoundStates (unit tests, the Camera Lab prototype) keep the old rule.
   */
  readonly ringOutDelayS?: number;
  /**
   * Owner, 2026-10-02 (Lote 9, item 20 / GDD 12): the round's time limit (s); 0 or omitted = no timer (the game's
   * rule so far). When it runs out with nobody beaten, the round is a Draw (PROVISIONAL: no judging rule was approved).
   */
  readonly timeLimitS?: number;
  /** Which win conditions count (MatchConfig.winBy*). Omitted = all three. A condition that is off never ends the round. */
  readonly winConditions?: { readonly ko: boolean; readonly ringOut: boolean; readonly spinOut: boolean };
}

export class RoundState {
  private outcome = RoundOutcome.Ongoing;
  private readonly ringOutDelayS: number;
  /** Continuous time (s) each Bey has spent outside the ring-out radius; back inside resets it. */
  private outsideS = { first: 0, second: 0 };
  private readonly timeLimitS: number;
  private readonly winConditions: { readonly ko: boolean; readonly ringOut: boolean; readonly spinOut: boolean };
  /** Seconds of play this round (advanced by tickClock). */
  private elapsedS = 0;

  constructor(options: RoundStateOptions = {}) {
    this.ringOutDelayS = Math.max(0, options.ringOutDelayS ?? 0);
    this.timeLimitS = Math.max(0, options.timeLimitS ?? 0);
    this.winConditions = options.winConditions ?? { ko: true, ringOut: true, spinOut: true };
  }

  /** Advances the round clock by one tick; past the time limit (if any) an undecided round becomes a Draw. Call after resolveTick. */
  tickClock(fixedDeltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedS += fixedDeltaSeconds;
    if (this.timeLimitS > 0 && this.elapsedS >= this.timeLimitS - 1e-9) this.outcome = RoundOutcome.Draw;
  }

  /** Seconds left on the round timer, or null when there is none (for the HUD). */
  get timeLeftS(): number | null {
    return this.timeLimitS > 0 ? Math.max(0, this.timeLimitS - this.elapsedS) : null;
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

    // Lote 9: a win condition that is off does not end the round.
    const w = this.winConditions;
    events = {
      firstKoed: w.ko && events.firstKoed,
      secondKoed: w.ko && events.secondKoed,
      firstRingOut: w.ringOut && events.firstRingOut,
      secondRingOut: w.ringOut && events.secondRingOut,
      firstSpunOut: w.spinOut && events.firstSpunOut === true,
      secondSpunOut: w.spinOut && events.secondSpunOut === true,
    };
    const firstLost = events.firstKoed || events.firstRingOut || events.firstSpunOut === true;
    const secondLost = events.secondKoed || events.secondRingOut || events.secondSpunOut === true;

    // Both on the same tick, whatever the causes: a Draw (the existing simultaneity rule).
    if (firstLost && secondLost) {
      this.outcome = RoundOutcome.Draw;
    } else if (secondLost) {
      this.outcome = events.secondKoed ? RoundOutcome.FirstWinsByKo : events.secondRingOut ? RoundOutcome.FirstWinsByRingOut : RoundOutcome.FirstWinsBySpinOut;
    } else if (firstLost) {
      this.outcome = events.firstKoed ? RoundOutcome.SecondWinsByKo : events.firstRingOut ? RoundOutcome.SecondWinsByRingOut : RoundOutcome.SecondWinsBySpinOut;
    }
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
  getDeterministicState(): CanonicalRecord {
    return { outcome: this.outcome, outsideS: { first: this.outsideS.first, second: this.outsideS.second }, elapsedS: this.elapsedS };
  }
}
