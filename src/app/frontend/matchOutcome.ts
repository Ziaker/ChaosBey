// ============================================================
// MATCH OUTCOME TEXT — WHAT THE PLAYER READS AT ROUND END (M10)
// Turns a RoundOutcome into the player's point of view: the player is
// always the first side.
// ============================================================

import { RoundOutcome } from '../../combat/round-rules/RoundState';

export type PlayerResult = 'win' | 'loss' | 'draw';

export interface OutcomeText {
  readonly result: PlayerResult;
  /** Big line: "VICTORY", "DEFEAT" or "DRAW". */
  readonly headline: string;
  /** How it ended, e.g. "Ring-out". */
  readonly finish: string;
}

export function outcomeText(outcome: RoundOutcome): OutcomeText | null {
  switch (outcome) {
    case RoundOutcome.Ongoing:
      return null;
    case RoundOutcome.FirstWinsByKo:
      return { result: 'win', headline: 'VICTORY', finish: 'Knock-out: the opponent was hit while broken' };
    case RoundOutcome.FirstWinsByRingOut:
      return { result: 'win', headline: 'VICTORY', finish: 'Ring-out: the opponent left the arena' };
    case RoundOutcome.SecondWinsByKo:
      return { result: 'loss', headline: 'DEFEAT', finish: 'Knock-out: you were hit while broken' };
    case RoundOutcome.SecondWinsByRingOut:
      return { result: 'loss', headline: 'DEFEAT', finish: 'Ring-out: you left the arena' };
    case RoundOutcome.FirstWinsBySpinOut:
      return { result: 'win', headline: 'VICTORY', finish: 'Spin-out: the opponent ran out of Stamina and stopped spinning' };
    case RoundOutcome.SecondWinsBySpinOut:
      return { result: 'loss', headline: 'DEFEAT', finish: 'Spin-out: you ran out of Stamina and stopped spinning' };
    case RoundOutcome.Draw:
      return { result: 'draw', headline: 'DRAW', finish: 'Both Beys went down on the same tick' };
  }
}
