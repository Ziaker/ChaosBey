// ============================================================
// MATCH SCORE — ROUNDS UNTIL SOMEONE WINS THE MATCH (M10)
// A match is "first to N round wins" (GDD: best-of structure is M10's
// rule configuration; RoundState only decides a single round). A draw
// scores nobody. Each round is its own deterministic match, with its own
// seed derived from the match seed.
// ============================================================

import { RoundOutcome } from '../../combat/round-rules/RoundState';

export interface MatchScore {
  readonly player: number;
  readonly opponent: number;
  /** Rounds played, draws included. */
  readonly rounds: number;
}

export const EMPTY_SCORE: MatchScore = { player: 0, opponent: 0, rounds: 0 };

export const ROUNDS_TO_WIN_CHOICES = [1, 2, 3] as const;
export type RoundsToWin = (typeof ROUNDS_TO_WIN_CHOICES)[number];

export function scoreRound(score: MatchScore, outcome: RoundOutcome): MatchScore {
  switch (outcome) {
    case RoundOutcome.FirstWinsByKo:
    case RoundOutcome.FirstWinsByRingOut:
    case RoundOutcome.FirstWinsBySpinOut:
      return { ...score, player: score.player + 1, rounds: score.rounds + 1 };
    case RoundOutcome.SecondWinsByKo:
    case RoundOutcome.SecondWinsByRingOut:
    case RoundOutcome.SecondWinsBySpinOut:
      return { ...score, opponent: score.opponent + 1, rounds: score.rounds + 1 };
    case RoundOutcome.Draw:
      return { ...score, rounds: score.rounds + 1 };
    case RoundOutcome.Ongoing:
      return score;
  }
}

/** 'player' / 'opponent' once one side has `roundsToWin` wins, else null. */
export function matchWinner(score: MatchScore, roundsToWin: number): 'player' | 'opponent' | null {
  if (score.player >= roundsToWin) return 'player';
  if (score.opponent >= roundsToWin) return 'opponent';
  return null;
}

/** Round 1 plays the match seed itself; later rounds derive from it. */
export function roundSeed(matchSeed: string, roundNumber: number): string {
  return roundNumber <= 1 ? matchSeed : `${matchSeed}/round-${roundNumber}`;
}

export function describeRoundsToWin(roundsToWin: number): string {
  return roundsToWin === 1 ? 'Single round' : `First to ${roundsToWin} (best of ${roundsToWin * 2 - 1})`;
}
