// ============================================================
// CLASH PRESENTATION ADAPTER
// The one interface between the real Clash state machine and any future Clash
// presentation (the approved Overdrive direction lives in the unmerged
// Clash Presentation Lab, PR #24, and is ported from there when its turn
// comes). The snapshot is read-only data derived from ClashController; no
// Clash rule is duplicated here, and the presentation never decides an
// outcome (GDD 158: VFX observes, never decides).
//
// The live power uses the same function the Clash itself and the current HUD
// bar use (computeClashPower), fed the same start-of-Clash values.
// ============================================================

import { ClashOutcome, ClashState } from '../combat/clash/ClashController';
import { computeClashPower } from '../combat/clash/ClashFormula';
import { CLASH_TARGET_DURATION_S } from '../combat/clash/ClashTuning';

/** The read-only part of ClashController the snapshot needs (the controller satisfies it). */
export interface ClashSource {
  getState(): ClashState;
  getElapsedS(): number;
  getCooldownRemainingS(): number;
  getFirstMashEventCount(): number;
  getSecondMashEventCount(): number;
  getFirstStaminaFractionAtStart(): number;
  getSecondStaminaFractionAtStart(): number;
  getFirstSpeedMpsAtStart(): number;
  getSecondSpeedMpsAtStart(): number;
  getLastResult(): { readonly outcome: ClashOutcome; readonly firstClashPower: number; readonly secondClashPower: number } | null;
}

export type ClashPhase = 'idle' | 'active' | 'cooldown';

export type ClashResolution = 'firstWins' | 'secondWins' | 'tie';

export interface ClashPresentationSnapshot {
  readonly phase: ClashPhase;
  readonly active: boolean;
  /** Elapsed share of the target duration while active, 0..1; 0 otherwise. */
  readonly progress: number;
  readonly elapsedS: number;
  /** Live power while active; the resolved powers while in cooldown; 0 while idle. */
  readonly firstPower: number;
  readonly secondPower: number;
  readonly firstMashEventCount: number;
  readonly secondMashEventCount: number;
  /** Set only while the Clash is in cooldown, i.e. just resolved; null while active or idle. */
  readonly resolution: ClashResolution | null;
  readonly cooldownRemainingS: number;
}

export const IDLE_CLASH_SNAPSHOT: ClashPresentationSnapshot = Object.freeze({
  phase: 'idle',
  active: false,
  progress: 0,
  elapsedS: 0,
  firstPower: 0,
  secondPower: 0,
  firstMashEventCount: 0,
  secondMashEventCount: 0,
  resolution: null,
  cooldownRemainingS: 0,
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const RESOLUTION_OF: Readonly<Record<ClashOutcome, ClashResolution>> = {
  [ClashOutcome.FirstWins]: 'firstWins',
  [ClashOutcome.SecondWins]: 'secondWins',
  [ClashOutcome.Tie]: 'tie',
};

export function selectClashPresentationSnapshot(clash: ClashSource): ClashPresentationSnapshot {
  const state = clash.getState();
  if (state === ClashState.Idle) return IDLE_CLASH_SNAPSHOT;
  if (state === ClashState.Active) {
    const firstMash = clash.getFirstMashEventCount();
    const secondMash = clash.getSecondMashEventCount();
    const elapsedS = clash.getElapsedS();
    return {
      phase: 'active',
      active: true,
      progress: clamp01(elapsedS / CLASH_TARGET_DURATION_S),
      elapsedS,
      firstPower: computeClashPower(firstMash, clash.getFirstStaminaFractionAtStart(), clash.getFirstSpeedMpsAtStart()),
      secondPower: computeClashPower(secondMash, clash.getSecondStaminaFractionAtStart(), clash.getSecondSpeedMpsAtStart()),
      firstMashEventCount: firstMash,
      secondMashEventCount: secondMash,
      resolution: null,
      cooldownRemainingS: 0,
    };
  }
  const last = clash.getLastResult();
  return {
    phase: 'cooldown',
    active: false,
    progress: 0,
    elapsedS: 0,
    firstPower: last ? last.firstClashPower : 0,
    secondPower: last ? last.secondClashPower : 0,
    firstMashEventCount: clash.getFirstMashEventCount(),
    secondMashEventCount: clash.getSecondMashEventCount(),
    resolution: last ? RESOLUTION_OF[last.outcome] : null,
    cooldownRemainingS: clash.getCooldownRemainingS(),
  };
}
