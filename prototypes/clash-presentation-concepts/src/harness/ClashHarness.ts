// ============================================================
// CLASH PRESENTATION LAB — HARNESS STATE MACHINE
// Wraps the real, GDD-approved src/combat/clash/ package UNCHANGED — the
// 150ms window, the ~4s Active duration, the mash formula and its caps,
// and the 10s Cooldown all come from there, not from this file. This
// class adds only the two PRESENTATION-ONLY beats either side of it:
//
//   Idle -> [Approach] -> Active -> [resolutionBurst] -> [cooldownWait] -> Idle
//                          ^^^^^^                          ^^^^^^^^^^^^
//                     real ClashController            both sub-beats of the
//                     Idle/Active/Cooldown             real Cooldown state
//
// "Approach" (a harness-authored convergence before the two attacks
// connect) and "resolutionBurst" (the window right after Active ends,
// while physical knockback plays out) do not exist in the real
// ClashController — they exist so the lab has something to show for the
// GDD's "entrada no Clash" and "resolução" beats without inventing a
// fourth real Clash state. See GDD sections 1.7 and 170: the fixed rules
// (window/duration/formula/caps/cooldown) are never re-derived here, only
// read from the real package.
// ============================================================

import { ClashController, ClashState, type ClashResult, type ClashStartInput } from '../../../../src/combat/clash/ClashController';
import { computeClashPower, computeMashPerformance, computeStaminaFactor, computeVelocityFactor } from '../../../../src/combat/clash/ClashFormula';
import { CLASH_TARGET_DURATION_S } from '../../../../src/combat/clash/ClashTuning';
import { isWithinClashWindow } from '../../../../src/combat/clash/ClashWindow';

export type ClashPhase = 'Idle' | 'Approach' | 'Active' | 'Cooldown';
export type ClashBeat = 'idle' | 'approaching' | 'active' | 'resolutionBurst' | 'cooldownWait';

/** Presentation-only: how long the "entrada" convergence plays before the two hits connect and the real ClashController takes over. Scenarios may override it; it has no equivalent in the real Clash rules. */
export const APPROACH_DURATION_S = 0.45;
/** Presentation-only: how long real physics keeps running right after Active -> Cooldown, so a physical knockback (and a possible natural ring-out) has time to play out on screen before the HUD settles into the Cooldown wait. Mirrors the Camera Lab's PRESENTATION_CONTINUATION_S pattern. */
export const RESOLUTION_BURST_DURATION_S = 2.5;

export interface ClashStartInputs extends ClashStartInput {
  /** Seconds between the two attacks connecting — a HUD/debug fact only. This lab always commits to the Clash once Approach ends (it has no real hit-detection to gate on), but the HUD shows whether that gap would actually fall inside the GDD's 150ms window. */
  connectDeltaS: number;
}

export interface ApproachInfo extends ClashStartInputs {
  withinWindow: boolean;
}

export interface MashEventEdge {
  isFirst: boolean;
  eventCount: number;
}

export interface ClashTickEvents {
  clashStarted: boolean;
  mashEvents: readonly MashEventEdge[];
  resolved: ClashResult | null;
  resolutionBurstEnded: boolean;
  cooldownEnded: boolean;
}

export interface SideLiveScore {
  mashEventCount: number;
  mashPerformance: number;
  staminaFactor: number;
  velocityFactor: number;
  clashPower: number;
}

export class ClashHarness {
  controller = new ClashController();
  private beatValue: ClashBeat = 'idle';
  private approachDurationS = APPROACH_DURATION_S;
  private approachRemainingS = 0;
  private resolutionBurstRemainingS = 0;
  private pendingStart: ClashStartInputs | null = null;
  private approachInfoValue: ApproachInfo | null = null;
  private previousFirstCount = 0;
  private previousSecondCount = 0;

  get phase(): ClashPhase {
    if (this.beatValue === 'approaching') return 'Approach';
    const s = this.controller.getState();
    if (s === ClashState.Active) return 'Active';
    if (s === ClashState.Cooldown) return 'Cooldown';
    return 'Idle';
  }

  get beat(): ClashBeat {
    return this.beatValue;
  }

  get approachInfo(): ApproachInfo | null {
    return this.approachInfoValue;
  }

  /** Fully resets the harness (a new Clash from scratch, e.g. loading a new scenario). */
  reset(): void {
    this.controller = new ClashController();
    this.beatValue = 'idle';
    this.approachRemainingS = 0;
    this.resolutionBurstRemainingS = 0;
    this.pendingStart = null;
    this.approachInfoValue = null;
    this.previousFirstCount = 0;
    this.previousSecondCount = 0;
  }

  /** Starts the presentation-only Approach beat. Only valid from Idle (mirrors ClashController.tryStart()'s own Idle-only guard, one level up). */
  beginApproach(inputs: ClashStartInputs, durationS = APPROACH_DURATION_S): boolean {
    if (this.phase !== 'Idle') return false;
    this.pendingStart = inputs;
    this.approachInfoValue = { ...inputs, withinWindow: isWithinClashWindow(inputs.connectDeltaS) };
    this.approachDurationS = Math.max(1 / 240, durationS);
    this.approachRemainingS = this.approachDurationS;
    this.previousFirstCount = 0;
    this.previousSecondCount = 0;
    this.beatValue = 'approaching';
    return true;
  }

  /** 0..1 through the Approach beat (for convergence easing); 1 once Active has started or outside Approach entirely. */
  get approachProgress01(): number {
    if (this.beatValue !== 'approaching') return 1;
    return Math.min(1, 1 - this.approachRemainingS / this.approachDurationS);
  }

  /** 0..1 through the resolutionBurst beat; 1 once it has ended (or outside it). */
  get resolutionBurstProgress01(): number {
    if (this.beatValue !== 'resolutionBurst') return 1;
    return Math.min(1, 1 - this.resolutionBurstRemainingS / RESOLUTION_BURST_DURATION_S);
  }

  /**
   * Advances the harness by exactly one fixed tick. `firstMashed`/
   * `secondMashed` are this tick's already-deduplicated "did this side
   * contribute a mash event" booleans (a keyboard capture or a scripted
   * source has already collapsed simultaneous Z+X+C into one); outside
   * Active they are ignored, exactly like the real ClashController.
   */
  tick(dt: number, firstMashed: boolean, secondMashed: boolean): ClashTickEvents {
    const events: ClashTickEvents = { clashStarted: false, mashEvents: [], resolved: null, resolutionBurstEnded: false, cooldownEnded: false };

    if (this.beatValue === 'approaching') {
      this.approachRemainingS -= dt;
      if (this.approachRemainingS <= 0 && this.pendingStart) {
        const started = this.controller.tryStart(this.pendingStart);
        this.pendingStart = null;
        this.beatValue = started ? 'active' : 'idle';
        events.clashStarted = started;
      }
      return events;
    }

    const stateBefore = this.controller.getState();
    const active = stateBefore === ClashState.Active;
    const noInput = { pressedActionIds: new Set<string>(), aiMashEventThisTick: false };
    const firstInput = active ? { pressedActionIds: new Set<string>(), aiMashEventThisTick: firstMashed } : noInput;
    const secondInput = active ? { pressedActionIds: new Set<string>(), aiMashEventThisTick: secondMashed } : noInput;
    this.controller.tick(dt, firstInput, secondInput);
    const stateAfter = this.controller.getState();

    const firstCount = this.controller.getFirstMashEventCount();
    const secondCount = this.controller.getSecondMashEventCount();
    const mashEvents: MashEventEdge[] = [];
    if (firstCount > this.previousFirstCount) mashEvents.push({ isFirst: true, eventCount: firstCount });
    if (secondCount > this.previousSecondCount) mashEvents.push({ isFirst: false, eventCount: secondCount });
    this.previousFirstCount = firstCount;
    this.previousSecondCount = secondCount;
    events.mashEvents = mashEvents;

    if (stateBefore === ClashState.Active && stateAfter === ClashState.Cooldown) {
      events.resolved = this.controller.getLastResult();
      this.beatValue = 'resolutionBurst';
      this.resolutionBurstRemainingS = RESOLUTION_BURST_DURATION_S;
    } else if (this.beatValue === 'resolutionBurst') {
      this.resolutionBurstRemainingS -= dt;
      if (this.resolutionBurstRemainingS <= 0) {
        events.resolutionBurstEnded = true;
        this.beatValue = 'cooldownWait';
      }
    }

    if (stateBefore === ClashState.Cooldown && stateAfter === ClashState.Idle) {
      events.cooldownEnded = true;
      this.beatValue = 'idle';
      this.approachInfoValue = null;
    }

    return events;
  }

  liveScore(isFirst: boolean): SideLiveScore {
    const mashEventCount = isFirst ? this.controller.getFirstMashEventCount() : this.controller.getSecondMashEventCount();
    const staminaFraction = isFirst ? this.controller.getFirstStaminaFractionAtStart() : this.controller.getSecondStaminaFractionAtStart();
    const speedMps = isFirst ? this.controller.getFirstSpeedMpsAtStart() : this.controller.getSecondSpeedMpsAtStart();
    return {
      mashEventCount,
      mashPerformance: computeMashPerformance(mashEventCount),
      staminaFactor: computeStaminaFactor(staminaFraction),
      velocityFactor: computeVelocityFactor(speedMps),
      clashPower: computeClashPower(mashEventCount, staminaFraction, speedMps),
    };
  }

  get elapsedActiveS(): number {
    return this.controller.getElapsedS();
  }

  get activeProgress01(): number {
    return Math.min(1, this.elapsedActiveS / CLASH_TARGET_DURATION_S);
  }

  get cooldownRemainingS(): number {
    return this.controller.getCooldownRemainingS();
  }
}
