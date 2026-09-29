// ============================================================
// MATCH SETUP — WHAT THE PLAYER CHOSE BEFORE A MATCH (M10)
// The pregame choices as plain data, and the one function that turns them
// into what a MatchSession is built from. Character Select fills the
// player's Bey; the Pregame screen fills the rest.
// ============================================================

import type { MatchBeys } from '../bootstrap/createMatchScene';
import { BEY_ROSTER, rosterEntry } from './beyRoster';

export interface MatchSetup {
  readonly playerBeyId: string;
  readonly opponentBeyId: string;
  /** Fixed seed text, or null for a fresh random seed every match. */
  readonly seedText: string | null;
}

/**
 * The opponent a player meets by default: the next Bey in the roster, so
 * the first match is never a mirror (Attack meets Defense, as in the
 * Debug Lab).
 */
export function defaultOpponentFor(playerBeyId: string): string {
  const index = BEY_ROSTER.findIndex((e) => e.definition.id === playerBeyId);
  const next = BEY_ROSTER[(index + 1) % BEY_ROSTER.length]!;
  return next.definition.id;
}

export function createDefaultMatchSetup(playerBeyId: string = BEY_ROSTER[0]!.definition.id): MatchSetup {
  return { playerBeyId, opponentBeyId: defaultOpponentFor(playerBeyId), seedText: null };
}

/** The Bey definitions the match is built with (player first, opponent second). */
export function matchBeysFor(setup: MatchSetup): MatchBeys {
  return { first: rosterEntry(setup.playerBeyId).definition, second: rosterEntry(setup.opponentBeyId).definition };
}
