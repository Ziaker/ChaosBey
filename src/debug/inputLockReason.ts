// ============================================================
// INPUT LOCK REASON — SHARED BY F3 AND THE DEBUG LAB INSPECTOR
// Owner playtest requirement: "never a bare control = 0 with no observable
// reason". Only the explicitly-approved blocking states count — Hitstop
// freeze, an Active Clash (mash input still reaches it; movement does
// not), and a decided round. Anything else means the player's real input
// is fully authoritative over the Bey (momentum/knockback/slope physics
// can still move it; see MovementController — this is about INPUT, not
// about freezing physics).
// ============================================================

import { ClashState } from '../combat/clash/ClashController';
import { RoundOutcome } from '../combat/round-rules/RoundState';
import type { MatchSession } from '../app/session/MatchSession';

export type InputLockReason = 'none' | 'Hitstop' | 'Clash' | 'RoundEnd';

export function inputLockReasonFor(session: MatchSession, isHitstopActive: boolean): InputLockReason {
  if (isHitstopActive) return 'Hitstop';
  if (session.clash.controller.getState() === ClashState.Active) return 'Clash';
  if (session.roundState.result !== RoundOutcome.Ongoing) return 'RoundEnd';
  return 'none';
}
