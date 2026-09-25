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

export class RoundState {
  private outcome = RoundOutcome.Ongoing;

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
}
