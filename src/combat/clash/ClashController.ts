// ============================================================
// CLASH CONTROLLER
// Milestone 5 core state machine: Idle -> Active (the ~4s mash contest) ->
// Cooldown (10s) -> Idle. Pure domain logic — no Three.js, Rapier, DOM, or
// dependency on this repo's real Action/input/tickMatch/camera/VFX code,
// so it can be built and tested in isolation while Milestone 4 is still
// in flight on those exact files.
//
// Deliberately NOT implemented yet (integration work for after Milestone
// 4 merges):
//   - wiring into tickMatch()'s hit-detection/knockback pipeline
//   - deriving `pressedActionIds`/`aiMashEventThisTick` from the real
//     Action enum / KeyboardController / AI
//   - applying CLASH_IMPACT_MULTIPLIER to any real knockback/Stability
//     change
//   - ring-out, camera, VFX, or any other presentation
//   - what a Tie actually *does* gameplay-wise (GDD explicitly requires
//     asking first) — Tie is only represented as a structural outcome
//     value here, with zero attached consequence.
// ============================================================

import { computeClashPower } from './ClashFormula';
import { nextMashEventCount } from './ClashMash';
import { CLASH_COOLDOWN_S, CLASH_TARGET_DURATION_S, CLASH_TIE_EPSILON } from './ClashTuning';

export enum ClashState {
  Idle = 'Idle',
  Active = 'Active',
  Cooldown = 'Cooldown',
}

export enum ClashOutcome {
  FirstWins = 'FirstWins',
  SecondWins = 'SecondWins',
  Tie = 'Tie',
}

export interface ClashStartInput {
  /** 0..1 */
  firstStaminaFraction: number;
  /** 0..1 */
  secondStaminaFraction: number;
  firstSpeedMps: number;
  secondSpeedMps: number;
}

/** One combatant's input for a single Clash tick — see ClashMash.ts for exactly how these count. */
export interface ClashCombatantInputTick {
  pressedActionIds: ReadonlySet<string>;
  aiMashEventThisTick: boolean;
}

export interface ClashResult {
  outcome: ClashOutcome;
  firstClashPower: number;
  secondClashPower: number;
  firstMashEventCount: number;
  secondMashEventCount: number;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

export class ClashController {
  private state: ClashState = ClashState.Idle;
  private elapsedS = 0;
  private cooldownRemainingS = 0;
  private firstMashEventCount = 0;
  private secondMashEventCount = 0;
  private firstStaminaFraction = 0;
  private secondStaminaFraction = 0;
  private firstSpeedMps = 0;
  private secondSpeedMps = 0;
  private lastResult: ClashResult | null = null;

  getState(): ClashState {
    return this.state;
  }

  isOnCooldown(): boolean {
    return this.state === ClashState.Cooldown;
  }

  getElapsedS(): number {
    return this.elapsedS;
  }

  getCooldownRemainingS(): number {
    return this.cooldownRemainingS;
  }

  getLastResult(): ClashResult | null {
    return this.lastResult;
  }

  /** Live running mash-event counts while Active (0 outside of an active contest) — for real-time debug/HUD display, distinct from getLastResult()'s post-resolution snapshot. */
  getFirstMashEventCount(): number {
    return this.firstMashEventCount;
  }

  getSecondMashEventCount(): number {
    return this.secondMashEventCount;
  }

  /**
   * Attempts to start a Clash. No-ops (returns false) if a Clash is
   * already Active or its Cooldown hasn't elapsed yet — a Clash can never
   * retrigger itself recursively or stack with another. The caller is
   * responsible for the 150ms window check (see ClashWindow.ts) before
   * calling this; this method only enforces the state-machine side of
   * "can a new Clash start right now".
   */
  tryStart(input: ClashStartInput): boolean {
    if (this.state !== ClashState.Idle) return false;

    this.state = ClashState.Active;
    this.elapsedS = 0;
    this.firstMashEventCount = 0;
    this.secondMashEventCount = 0;
    this.firstStaminaFraction = clamp01(input.firstStaminaFraction);
    this.secondStaminaFraction = clamp01(input.secondStaminaFraction);
    this.firstSpeedMps = Math.max(0, input.firstSpeedMps);
    this.secondSpeedMps = Math.max(0, input.secondSpeedMps);
    return true;
  }

  /**
   * Advances the Clash by exactly one fixed tick. Safe to call every tick
   * regardless of state — a no-op while Idle. Purely time/count-driven
   * (fixedDeltaSeconds accumulation, integer tick-based mash counting), so
   * repeating the same input sequence always produces the same timings and
   * outcome.
   */
  tick(fixedDeltaSeconds: number, firstInput: ClashCombatantInputTick, secondInput: ClashCombatantInputTick): void {
    if (this.state === ClashState.Active) {
      this.firstMashEventCount = nextMashEventCount(this.firstMashEventCount, firstInput.pressedActionIds, firstInput.aiMashEventThisTick);
      this.secondMashEventCount = nextMashEventCount(this.secondMashEventCount, secondInput.pressedActionIds, secondInput.aiMashEventThisTick);
      this.elapsedS += fixedDeltaSeconds;
      if (this.elapsedS >= CLASH_TARGET_DURATION_S) {
        this.resolve();
      }
    } else if (this.state === ClashState.Cooldown) {
      this.cooldownRemainingS = Math.max(0, this.cooldownRemainingS - fixedDeltaSeconds);
      if (this.cooldownRemainingS <= 0) {
        this.state = ClashState.Idle;
      }
    }
  }

  private resolve(): void {
    const firstClashPower = computeClashPower(this.firstMashEventCount, this.firstStaminaFraction, this.firstSpeedMps);
    const secondClashPower = computeClashPower(this.secondMashEventCount, this.secondStaminaFraction, this.secondSpeedMps);

    let outcome: ClashOutcome;
    if (Math.abs(firstClashPower - secondClashPower) <= CLASH_TIE_EPSILON) {
      outcome = ClashOutcome.Tie;
    } else {
      outcome = firstClashPower > secondClashPower ? ClashOutcome.FirstWins : ClashOutcome.SecondWins;
    }

    this.lastResult = {
      outcome,
      firstClashPower,
      secondClashPower,
      firstMashEventCount: this.firstMashEventCount,
      secondMashEventCount: this.secondMashEventCount,
    };
    this.state = ClashState.Cooldown;
    this.cooldownRemainingS = CLASH_COOLDOWN_S;
  }
}
