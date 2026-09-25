// ============================================================
// CLASH MASH COUNTING
// Discrete mash-event counting for the Clash mini-contest (GDD): any
// number of qualifying actions (Z/X/C in the eventual real integration —
// this package only sees opaque action identifiers, never the real
// Action enum) pressed together in the *same* tick count as exactly one
// mash event; the same actions pressed across separate ticks count once
// each. Kept as plain functions/types with no dependency on the real
// input system, so Milestone 5's core logic doesn't couple to Milestone
// 4's in-flight input work.
// ============================================================

/**
 * Advances a mash-event counter by one fixed tick's worth of input.
 * `pressedActionIds` is whatever qualifying action identifiers transitioned
 * to pressed *this tick* (e.g. a future adapter would pass
 * ControllerActions.pressedThisFrame filtered to Z/X/C) — any non-empty
 * set counts as exactly one event, however many distinct actions it
 * contains, so pressing all three simultaneously never counts as three.
 * `aiMashEventThisTick` is a separate, independent contribution (see
 * ClashAiMashSource below) — a real press and an AI contribution in the
 * same tick count as two events, since they come from different sources.
 */
export function nextMashEventCount(currentCount: number, pressedActionIds: ReadonlySet<string>, aiMashEventThisTick: boolean): number {
  let next = currentCount;
  if (pressedActionIds.size > 0) next += 1;
  if (aiMashEventThisTick) next += 1;
  return next;
}

/**
 * Pure, deterministic abstraction for how the (future Milestone 7) AI
 * contributes mash events during a Clash. This package has no AI logic of
 * its own — just the contract ClashController's caller needs to decide,
 * per tick, whether the AI contributed a mash event this tick. The real
 * AI implementation drops in behind this interface later without
 * changing ClashController.
 */
export interface ClashAiMashSource {
  sampleTick(tickIndex: number, clashElapsedS: number): boolean;
}

/**
 * Deterministic placeholder implementation — NOT the real AI. Contributes
 * exactly one mash event every `intervalTicks` ticks (tick 0, 0+interval,
 * 0+2*interval, ...). Exists so self-tests (and early tuning) can exercise
 * the AI-mash pathway through ClashController without needing real AI
 * behavior; Milestone 7's actual AI mash strategy replaces this.
 */
export class FixedIntervalAiMashSource implements ClashAiMashSource {
  constructor(private readonly intervalTicks: number) {}

  sampleTick(tickIndex: number, _clashElapsedS: number): boolean {
    return this.intervalTicks > 0 && tickIndex % this.intervalTicks === 0;
  }
}
