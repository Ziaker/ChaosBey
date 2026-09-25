// ============================================================
// ROUND STATE — MINIMAL ROUND FLOW (MILESTONE 2 FOUNDATION)
// Win-condition detection and round-end state only. Best-of-3 match
// structure, presentation and rule configuration are Milestone 10
// (pregame/presentation) — this just answers "is the round over, and how".
// ============================================================

export enum RoundOutcome {
  Ongoing = 'Ongoing',
  FirstWinsByKo = 'FirstWinsByKo',
  SecondWinsByKo = 'SecondWinsByKo',
  FirstWinsByRingOut = 'FirstWinsByRingOut',
  SecondWinsByRingOut = 'SecondWinsByRingOut',
}

export class RoundState {
  private outcome = RoundOutcome.Ongoing;

  get isOver(): boolean {
    return this.outcome !== RoundOutcome.Ongoing;
  }

  get result(): RoundOutcome {
    return this.outcome;
  }

  /** A qualifying hit landed on an already-Broken defender (GDD section 29 Stability Break model). */
  registerKo(winnerIsFirst: boolean): void {
    if (this.isOver) return;
    this.outcome = winnerIsFirst ? RoundOutcome.FirstWinsByKo : RoundOutcome.SecondWinsByKo;
  }

  registerRingOut(loserIsFirst: boolean): void {
    if (this.isOver) return;
    this.outcome = loserIsFirst ? RoundOutcome.SecondWinsByRingOut : RoundOutcome.FirstWinsByRingOut;
  }
}
