// ============================================================
// CLASH TRIGGER WINDOW
// Pure timing check for the GDD-approved 150ms Clash window — kept
// separate from ClashController so "is this pair of hits eligible" can be
// tested/reasoned about independently of Clash's own state machine.
// ============================================================

import { CLASH_WINDOW_S } from './ClashTuning';

/**
 * True if two attack-connect events this many seconds apart are eligible
 * to Clash (GDD section 150ms window). Inclusive at the boundary. Does
 * NOT check whether a Clash is already active or on cooldown — that's
 * ClashController.tryStart()'s job, so this stays a pure timing question.
 */
export function isWithinClashWindow(deltaSeconds: number): boolean {
  return Math.abs(deltaSeconds) <= CLASH_WINDOW_S;
}
