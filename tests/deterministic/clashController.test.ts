// ============================================================
// CLASH CONTROLLER SELF-TESTS
// Full lifecycle (Idle -> Active -> Cooldown -> Idle) plus the specific
// regressions Milestone 5's core must guard against: no recursive
// retrigger, cooldown actually blocks a new Clash, Tie is representable,
// and timers are deterministic under repeated fixed-timestep runs.
// ============================================================

import { describe, expect, it } from 'vitest';
import { ClashController, ClashOutcome, ClashState, type ClashCombatantInputTick } from '../../src/combat/clash/ClashController';
import { CLASH_COOLDOWN_S, CLASH_TARGET_DURATION_S } from '../../src/combat/clash/ClashTuning';

const FIXED_DELTA_SECONDS = 1 / 60;
// +1 tick of headroom: summing FIXED_DELTA_SECONDS (1/60, not exactly
// representable in binary floating point) CLASH_TARGET_DURATION_S/dt times
// can land a hair under the target instead of exactly on it — the ±1 tick
// tolerance real gameplay doesn't care about, just like Milestone 3's
// whiff-recovery-timing test documents for the same reason.
const DURATION_TICKS = Math.ceil(CLASH_TARGET_DURATION_S / FIXED_DELTA_SECONDS) + 1;
const COOLDOWN_TICKS = Math.ceil(CLASH_COOLDOWN_S / FIXED_DELTA_SECONDS) + 1;

const NO_INPUT: ClashCombatantInputTick = { pressedActionIds: new Set(), aiMashEventThisTick: false };

function pressInput(actionId: string): ClashCombatantInputTick {
  return { pressedActionIds: new Set([actionId]), aiMashEventThisTick: false };
}

function runTicks(controller: ClashController, count: number, firstInput: ClashCombatantInputTick, secondInput: ClashCombatantInputTick): void {
  for (let i = 0; i < count; i++) {
    controller.tick(FIXED_DELTA_SECONDS, firstInput, secondInput);
  }
}

describe('ClashController lifecycle', () => {
  it('starts Idle, and tryStart() transitions it to Active', () => {
    const controller = new ClashController();
    expect(controller.getState()).toBe(ClashState.Idle);

    const started = controller.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 5, secondSpeedMps: 5 });
    expect(started).toBe(true);
    expect(controller.getState()).toBe(ClashState.Active);
  });

  it('auto-resolves into Cooldown once the target duration elapses, then returns to Idle after the cooldown', () => {
    const controller = new ClashController();
    controller.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 5, secondSpeedMps: 5 });

    runTicks(controller, DURATION_TICKS, NO_INPUT, NO_INPUT);
    expect(controller.getState()).toBe(ClashState.Cooldown);
    expect(controller.getLastResult()).not.toBeNull();

    runTicks(controller, COOLDOWN_TICKS, NO_INPUT, NO_INPUT);
    expect(controller.getState()).toBe(ClashState.Idle);
  });
});

describe('no recursive retrigger', () => {
  it('tryStart() while already Active is a no-op and does not reset progress', () => {
    const controller = new ClashController();
    controller.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 5, secondSpeedMps: 5 });
    runTicks(controller, 30, pressInput('Attack'), NO_INPUT);
    const elapsedBefore = controller.getElapsedS();

    const retriggered = controller.tryStart({ firstStaminaFraction: 0, secondStaminaFraction: 0, firstSpeedMps: 0, secondSpeedMps: 0 });

    expect(retriggered).toBe(false);
    expect(controller.getState()).toBe(ClashState.Active);
    expect(controller.getElapsedS()).toBeCloseTo(elapsedBefore, 5);
  });
});

describe('cooldown blocks a new Clash', () => {
  it('tryStart() during Cooldown returns false; it succeeds again only once the cooldown has fully elapsed', () => {
    const controller = new ClashController();
    controller.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 5, secondSpeedMps: 5 });
    runTicks(controller, DURATION_TICKS, NO_INPUT, NO_INPUT);
    expect(controller.getState()).toBe(ClashState.Cooldown);

    expect(controller.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 5, secondSpeedMps: 5 })).toBe(false);

    // Most of the way through cooldown — still blocked.
    runTicks(controller, Math.floor((CLASH_COOLDOWN_S - 0.1) / FIXED_DELTA_SECONDS), NO_INPUT, NO_INPUT);
    expect(controller.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 5, secondSpeedMps: 5 })).toBe(false);

    // Finish the cooldown.
    runTicks(controller, Math.ceil(0.2 / FIXED_DELTA_SECONDS), NO_INPUT, NO_INPUT);
    expect(controller.getState()).toBe(ClashState.Idle);
    expect(controller.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 5, secondSpeedMps: 5 })).toBe(true);
  });
});

describe('Tie is representable', () => {
  it('produces ClashOutcome.Tie when both sides end with equal ClashPower, with zero attached consequence beyond the outcome value', () => {
    const controller = new ClashController();
    controller.tryStart({ firstStaminaFraction: 0.8, secondStaminaFraction: 0.8, firstSpeedMps: 4, secondSpeedMps: 4 });

    // Identical mash input for both sides every tick -> identical ClashPower.
    runTicks(controller, DURATION_TICKS, pressInput('Attack'), pressInput('Attack'));

    const result = controller.getLastResult();
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe(ClashOutcome.Tie);
    expect(result!.firstClashPower).toBeCloseTo(result!.secondClashPower, 10);
  });

  it('a clear mash advantage produces FirstWins/SecondWins, not Tie', () => {
    const controller = new ClashController();
    controller.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 5, secondSpeedMps: 5 });

    for (let i = 0; i < DURATION_TICKS; i++) {
      // First mashes every tick, second never does.
      controller.tick(FIXED_DELTA_SECONDS, pressInput('Attack'), NO_INPUT);
    }

    expect(controller.getLastResult()!.outcome).toBe(ClashOutcome.FirstWins);
  });
});

describe('AI mash contributes to ClashPower through the controller', () => {
  it('a side with AI mash contributions ends with a higher mash count (and ClashPower) than an otherwise-identical side without', () => {
    const withAi = new ClashController();
    withAi.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 5, secondSpeedMps: 5 });
    const withoutAi = new ClashController();
    withoutAi.tryStart({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 5, secondSpeedMps: 5 });

    const aiInput: ClashCombatantInputTick = { pressedActionIds: new Set(), aiMashEventThisTick: true };
    runTicks(withAi, DURATION_TICKS, aiInput, NO_INPUT);
    runTicks(withoutAi, DURATION_TICKS, NO_INPUT, NO_INPUT);

    expect(withAi.getLastResult()!.firstMashEventCount).toBeGreaterThan(withoutAi.getLastResult()!.firstMashEventCount);
    expect(withAi.getLastResult()!.firstClashPower).toBeGreaterThan(withoutAi.getLastResult()!.firstClashPower);
  });
});

describe('deterministic timers under fixed timestep', () => {
  it('the same tick sequence always produces identical elapsed time, mash counts and outcome', () => {
    function run(): ReturnType<ClashController['getLastResult']> {
      const controller = new ClashController();
      controller.tryStart({ firstStaminaFraction: 0.6, secondStaminaFraction: 0.9, firstSpeedMps: 3, secondSpeedMps: 7 });
      for (let i = 0; i < DURATION_TICKS; i++) {
        const firstInput = i % 3 === 0 ? pressInput('Attack') : NO_INPUT;
        const secondInput = i % 5 === 0 ? pressInput('Dodge') : NO_INPUT;
        controller.tick(FIXED_DELTA_SECONDS, firstInput, secondInput);
      }
      return controller.getLastResult();
    }

    const first = run();
    const second = run();
    expect(first).toEqual(second);
  });
});
